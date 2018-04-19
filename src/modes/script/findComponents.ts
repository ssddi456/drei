import * as fs from 'fs';
import * as ts from 'typescript';
import { Definition, Range } from 'vscode-languageserver-types';
import Uri from 'vscode-uri';

export interface PropInfo {
    name: string;
    doc?: string;
}

export interface ComponentInfo {
    name: string;
    definition?: Definition;
    props?: PropInfo[];
}

export function findComponents(program: ts.Program, fileFsPath: string): ComponentInfo[] {

    const componentInfoProvider = getComponentInfoProvider(program, fileFsPath);

    const childComps = componentInfoProvider.getPropertyType('components');
    if (!childComps) {
        return [];
    }

    return componentInfoProvider.checker.getPropertiesOfType(childComps)
        .map(s => getCompInfo(s, componentInfoProvider.checker));
}

export interface ComponentInfoMemberKeys {
    fileName : string;
    dataKeys: string[];
    initDataReturnKeys: string[];
    computedKeys: string[];
    filterKeys: string[];
    allMemberFunctionKeys: string[];
}

export interface ComponentInfoProvider {
    checker: ts.TypeChecker;
    defaultExportType: ts.Type;
    getPropertyType(name: string): ts.Type;
    getPropertyTypeOfType(type: ts.Type, name: string): ts.Type;
    getMemberKeys(): ComponentInfoMemberKeys
}

const NULL_COMPONENT_INFO_PROVIDER: ComponentInfoProvider = {
    checker: undefined,
    defaultExportType: undefined,
    getPropertyType(this: ComponentInfoProvider) {
        return undefined;
    },
    getPropertyTypeOfType(this: ComponentInfoProvider) {
        return undefined;
    },
    getMemberKeys(this: ComponentInfoProvider) {
        return {
            fileName: '',
            dataKeys: [],
            initDataReturnKeys: [],
            computedKeys: [],
            filterKeys: [],
            allMemberFunctionKeys: [],
        };
    }
}


function getMemberKeys(objectType: ts.Type, checker: ts.TypeChecker): string[] {
    return objectType ? Array.from(checker.getPropertiesOfType(objectType).map(s => s.name)) : undefined;
}

export function getComponentInfoProvider(program: ts.Program, fileFsPath: string): ComponentInfoProvider {
    console.log('getComponentInfoProvider', fileFsPath);

    const sourceFile = program.getSourceFile(fileFsPath);
    if (!sourceFile) {
        console.log('no source file we need wait for next loop');
        return NULL_COMPONENT_INFO_PROVIDER;
    }

    console.log('so we end get sourcefile', fileFsPath, !!sourceFile, fs.existsSync(fileFsPath));

    const exportStmt = sourceFile.statements.filter(st => st.kind === ts.SyntaxKind.ExportAssignment);

    console.log('exportStmt.length', exportStmt.length);

    if (exportStmt.length === 0) {
        return NULL_COMPONENT_INFO_PROVIDER;
    }

    const exportExpr = (exportStmt[0] as ts.ExportAssignment).expression;
    const comp = getComponentFromExport(exportExpr);
    console.log('compononents', !!comp);
    if (!comp) {
        return NULL_COMPONENT_INFO_PROVIDER;
    }

    const checker = program.getTypeChecker();
    const compType = checker.getTypeAtLocation(comp);

    return {
        checker: checker,
        defaultExportType: compType,
        getPropertyType(name) {
            return getPropertyTypeOfType(compType, name, checker);
        },
        getPropertyTypeOfType(compType, name) {
            return getPropertyTypeOfType(compType, name, checker);
        },
        getMemberKeys(this: ComponentInfoProvider) {

            const checker = this.checker;
            const dataProperties = this.getPropertyType('data');
            // or the return type of initData
            const dataKeys = getMemberKeys(dataProperties, checker);

            const initDataMethodType = (this.getPropertyType('initData')) as ts.ObjectType;
            const initDataReturnType = (initDataMethodType && (initDataMethodType.objectFlags & ts.ObjectFlags.Anonymous)) ?
                this.checker.getSignaturesOfType(initDataMethodType, ts.SignatureKind.Call)[0].getReturnType() : undefined;
            const initDataReturnKeys = getMemberKeys(initDataReturnType, checker);

            // get computed data type should get its return type
            const computedProperties = this.getPropertyType('computed');
            const computedKeys = getMemberKeys(computedProperties, checker);

            const filterProperties = this.getPropertyType('filters');
            const filterKeys = getMemberKeys(filterProperties, checker);

            const allMembers = checker ? checker.getPropertiesOfType(this.defaultExportType) : [];

            console.log('dataKeys', dataKeys);
            console.log('initDataReturnKeys', initDataReturnKeys);
            console.log('computedKeys', computedKeys);
            console.log('filterKeys', filterKeys);


            const allMemberFunctionKeys: string[] = [];
            for (let i = 0; i < allMembers.length; i++) {
                const symbol = allMembers[i];

                if (symbol.flags & ts.SymbolFlags.Method) {
                    allMemberFunctionKeys.push(symbol.name);
                }
            }

            return {
                fileName: sourceFile.fileName,
                dataKeys,
                initDataReturnKeys,
                computedKeys,
                filterKeys,
                allMemberFunctionKeys,
            }
        }
    }
}


function getComponentFromExport(exportExpr: ts.Expression) {
    switch (exportExpr.kind) {
        case ts.SyntaxKind.CallExpression:
            // San.createComponent or synthetic __sanEditorBridge
            return (exportExpr as ts.CallExpression).arguments[0];
        case ts.SyntaxKind.ObjectLiteralExpression:
            return exportExpr;
    }
    return undefined;
}

// San.createComponent will return a type without `props`. We need to find the object literal
function findDefinitionLiteralSymbol(symbol: ts.Symbol, checker: ts.TypeChecker) {
    const node = symbol.valueDeclaration;
    if (!node) {
        return undefined;
    }
    if (node.kind === ts.SyntaxKind.PropertyAssignment) {
        // {comp: importedComponent}
        symbol = checker.getSymbolAtLocation((node as ts.PropertyAssignment).initializer) || symbol;
    } else if (node.kind === ts.SyntaxKind.ShorthandPropertyAssignment) {
        // {comp}
        symbol = checker.getShorthandAssignmentValueSymbol(node) || symbol;
    }
    if (symbol.flags & ts.SymbolFlags.Alias) {
        // resolve import Comp from './comp.san'
        symbol = checker.getAliasedSymbol(symbol);
    }
    return symbol;
}

function getCompInfo(symbol: ts.Symbol, checker: ts.TypeChecker) {
    const info: ComponentInfo = {
        name: hyphenate(symbol.name)
    };
    const literalSymbol = findDefinitionLiteralSymbol(symbol, checker);
    if (!literalSymbol) {
        return info;
    }
    const declaration = literalSymbol.valueDeclaration;
    if (!declaration) {
        return info;
    }
    info.definition = [
        {
            uri: Uri.file(declaration.getSourceFile().fileName).toString(),
            range: Range.create(0, 0, 0, 0)
        }
    ];

    let node: ts.Node = declaration;
    if (declaration.kind === ts.SyntaxKind.ExportAssignment) {
        const expr = (declaration as ts.ExportAssignment).expression;
        node = getComponentFromExport(expr) || declaration;
    }
    const compType = checker.getTypeAtLocation(node);
    const arrayProps = getArrayProps(compType, checker);
    if (arrayProps) {
        info.props = arrayProps;
        return info;
    }
    const props = getPropertyTypeOfType(compType, 'props', checker);
    if (!props) {
        return info;
    }
    info.props = checker.getPropertiesOfType(props).map(s => {
        return {
            name: hyphenate(s.name),
            doc: getPropTypeDeclaration(s, checker)
        };
    });
    return info;
}

function getPropTypeDeclaration(prop: ts.Symbol, checker: ts.TypeChecker) {
    if (!prop.valueDeclaration) {
        return '';
    }
    const declaration = prop.valueDeclaration.getChildAt(2);
    if (!declaration) {
        return '';
    }
    if (declaration.kind === ts.SyntaxKind.ObjectLiteralExpression) {
        const text: string[] = [];
        declaration.forEachChild(n => {
            text.push(n.getText());
        });
        return text.join('\n');
    }
    return declaration.getText();
}

function isStringLiteral(e: ts.Expression): e is ts.StringLiteral {
    return e.kind === ts.SyntaxKind.StringLiteral;
}

function getArrayProps(compType: ts.Type, checker: ts.TypeChecker) {
    const propSymbol = checker.getPropertyOfType(compType, 'props');
    if (!propSymbol || !propSymbol.valueDeclaration) {
        return undefined;
    }
    const propDef = propSymbol.valueDeclaration.getChildAt(2);
    if (!propDef || propDef.kind !== ts.SyntaxKind.ArrayLiteralExpression) {
        return undefined;
    }
    const propArray = propDef as ts.ArrayLiteralExpression;
    return propArray.elements
        .filter(isStringLiteral)
        .map(e => ({ name: hyphenate(e.text) }));
}

function getPropertyTypeOfType(tpe: ts.Type, property: string, checker: ts.TypeChecker) {
    const propSymbol = checker.getPropertyOfType(tpe, property);
    return getSymbolType(propSymbol, checker);
}

function getSymbolType(symbol: ts.Symbol | undefined, checker: ts.TypeChecker) {
    if (!symbol || !symbol.valueDeclaration) {
        return undefined;
    }
    return checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration);
}

const hyphenateRE = /\B([A-Z])/g;
function hyphenate(word: string) {
    return word.replace(hyphenateRE, '-$1').toLowerCase();
}
