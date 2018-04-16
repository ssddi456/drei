import * as fs from 'fs';
import * as ts from 'typescript';
import { getComponentInfoProvider } from "./../../script/findComponents";
import { ComponentInfoProvider } from "./../../script/findComponents";
import { Node, parse } from '../parser/htmlParser';

import * as San from 'san';
import { logger } from '../../../utils/logger';
import { setZeroPos, setZeroPosed } from '../../script/astHelper';

Error.stackTraceLimit = 100;
Error.prototype.stackTraceLimit = 100;

logger.clear();

interface SanExpression {
    directive?: string;
    event?: string;

    // for val- xxx
    scopedValue?: string;

    start: number;
    end: number;

    value: string;

    // for san-for
    itemName?: string;
    indexName?: string;
    interatorName?: string;
}

type SanAttribute = string | SanExpression

class SanNode extends Node {
    parent: SanNode;
    children: SanNode[];
    sanAttributes?: {
        [k: string]: SanAttribute
    };
    scope: SanScope;
    findNodeBefore(offset: number): SanNode {
        return super.findNodeBefore(offset) as SanNode;
    }
    findNodeAt(offset: number): SanNode {
        return super.findNodeAt(offset) as SanNode;
    }
}


class SanScope {
    constructor(public parentScope: SanScope, public scopeContext: ComponentInfoProvider) { }
    findTypeByName(name: string): ts.Type {
        if (this.scopeContext) {
            /**
             * 先查找 data
             * 再查找 computed
             * 再查找字面属性
             */
            const dataPropType = this.scopeContext.getPropertyType('data');
            if (dataPropType) {
                const propOnData = this.scopeContext.getPropertyTypeOfType(dataPropType, name);
                if (propOnData) {
                    return propOnData;
                }
            }
            const computedPropType = this.scopeContext.getPropertyType('data');
            if (computedPropType) {
                const propOnData = this.scopeContext.getPropertyTypeOfType(computedPropType, name);
                if (propOnData) {
                    return propOnData;
                }
            }
            const propOnData = this.scopeContext.getPropertyType(name);
            if (propOnData) {
                return propOnData;
            }
        }
        if (this.parentScope) {
            return this.parentScope.findTypeByName(name);
        }
        return undefined;
    }
}

function createScope(sanNode: SanNode, currentScope: SanScope) {
    if (!sanNode.scope) {
        sanNode.scope = currentScope;
    }
    if (sanNode.children) {
        let childScope: SanScope = currentScope;
        if (sanNode.tag === 'slot') {
            // create a new top scope with propertyMap
            const propertiesMap = {} as { [k: string]: string };
            sanNode.attributeNames.filter(x => x.indexOf('var-') == 0)
                .forEach(x => {
                    const expression = sanNode.sanAttributes[x] as SanExpression;
                    propertiesMap[expression.scopedValue] = expression.value
                });
            type scopeValueProvider = ComponentInfoProvider & { propertiesMap: typeof propertiesMap };
            const scopeValueProvider: scopeValueProvider = {
                checker: currentScope.scopeContext.checker,
                defaultExportType: undefined,
                propertiesMap,
                getPropertyType(this: scopeValueProvider, name: string) {
                    if (this.propertiesMap.hasOwnProperty(name)) {
                        return currentScope.scopeContext.getPropertyType(
                            this.propertiesMap[name]);
                    }
                    return undefined;
                },
                getPropertyTypeOfType(prop: ts.Type, name: string) {
                    return currentScope.scopeContext.getPropertyTypeOfType(prop, name);
                }
            };
            childScope = new SanScope(undefined, scopeValueProvider);
        }
        if (sanNode.attributeNames.filter(x => x === 's-for' || x === 'san-for').length) {
            const forExpression = sanNode.sanAttributes[sanNode.attributeNames
                .filter(x => x === 's-for' || x === 'san-for')[0]] as SanExpression;

            const scopeValueProvider: ComponentInfoProvider = {
                checker: currentScope.scopeContext.checker,
                defaultExportType: undefined,
                getPropertyType(this: ComponentInfoProvider, name: string) {
                    // TODO: find type for forExpression
                    if (name == forExpression.indexName) {
                    } else if (name == forExpression.itemName) {

                    }
                    return undefined;
                },
                getPropertyTypeOfType(prop: ts.Type, name: string) {
                    return currentScope.scopeContext.getPropertyTypeOfType(prop, name);
                }
            };
            childScope = new SanScope(undefined, scopeValueProvider);
        }

        sanNode.children.forEach(x => createScope(x, childScope));
    }
}

let testSanTemplate = '';
testSanTemplate = `
    <div>
        <div s-if="false">
            <div class="{{ wtf }}   {{another wtf}}  ">lets make a test {{one}}</div>
            <button value="{= myValue =}" on-click="increase"> incress </button>
        </div>
        <div s-for="a in b"></div>
        <div s-for="a,c in b"></div>
    </div>
`;

testSanTemplate = `<div s-for="a, c in b['some']"></div>`;
const myDoc = parse(testSanTemplate);
// const myDoc = parse(testSanTemplate);


function getTextContent(node: SanNode, source: string) {
    console.log('---------------\n' + source.slice(node.start, node.end) + '\n---------------');
    node.children.forEach(function (node) {
        getTextContent(node, source);
    });
}


function nodeTypeLogger<T extends ts.Node>(context: ts.TransformationContext) {
    return function (rootNode: T) {
        function visit(node: ts.Node): ts.Node {
            console.log("Visiting " + ts.SyntaxKind[node.kind]);

            if (node.kind == ts.SyntaxKind.Identifier) {
                console.log((node as ts.Identifier).escapedText);
            }

            return ts.visitEachChild(node, visit, context);
        }
        return ts.visitNode(rootNode, visit);
    }
}

const insertedName = 'instance';
const initDataReturnTypeName = 'initDataReturnTypeName';
const computedTypeName = 'computedTypeName';

function getMemberKeys(objectType: ts.Type, checker: ts.TypeChecker): string[] {
    return objectType ? Array.from(checker.getPropertiesOfType(objectType).map(s => s.name)) : undefined;
}

function insectComponentInfo(insertedName: string, inforProvider: ComponentInfoProvider) {

    const checker = inforProvider.checker;
    const dataProperties = inforProvider ? inforProvider.getPropertyType('data') : undefined;
    // or the return type of initData
    const dataKeys = getMemberKeys(dataProperties, checker);

    const initDataMethodType = (inforProvider ? inforProvider.getPropertyType('initData') : undefined) as ts.ObjectType;
    const initDataReturnType = (initDataMethodType && (initDataMethodType.objectFlags & ts.ObjectFlags.Anonymous)) ?
        inforProvider.checker.getSignaturesOfType(initDataMethodType, ts.SignatureKind.Call)[0].getReturnType() : undefined;
    const initDataReturnKeys = getMemberKeys(initDataReturnType, checker);

    // get computed data type should get its return type
    const computedProperties = inforProvider ? inforProvider.getPropertyType('computed') : undefined;
    const computedKeys = getMemberKeys(computedProperties, checker);

    const filterProperties = inforProvider ? inforProvider.getPropertyType('filters') : undefined;
    const filterKeys = getMemberKeys(filterProperties, checker);

    const allMembers = inforProvider ? checker.getPropertiesOfType(inforProvider.defaultExportType) : undefined;

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

    return function findInsertPoint<T extends ts.Node>(context: ts.TransformationContext) {

        return function (rootNode: T) {
            console.log('-.-~');

            let lastNoneIdentifierNodeKind: ts.SyntaxKind;
            let lastNodeKind: ts.SyntaxKind;

            function visit(node: ts.Node): ts.Node {
                console.log("Visiting " + ts.SyntaxKind[node.kind]);
                if (node.kind == ts.SyntaxKind.SourceFile) {
                    console.log('insert import dependance');

                    const file = node as ts.SourceFile;
                    const statements: Array<ts.Statement> = file.statements as any;

                    if (initDataReturnType) {
                        statements.unshift(
                            setZeroPos(ts.createTypeAliasDeclaration(
                                undefined,
                                undefined,
                                setZeroPos(ts.createIdentifier(initDataReturnTypeName)),
                                undefined,
                                setZeroPos(ts.createTypeReferenceNode(
                                    ts.createIdentifier('ReturnType'),
                                    [ts.createTypeQueryNode(
                                        ts.createQualifiedName(
                                            ts.createIdentifier(insertedName),
                                            ts.createIdentifier('initData')))]
                                ))
                            ))
                        );
                    }

                    if (computedProperties) {
                        const members = computedKeys.map(x => {
                            return ts.createPropertySignature(
                                undefined,
                                ts.createIdentifier(x),
                                undefined,
                                ts.createTypeReferenceNode(
                                    ts.createIdentifier('ReturnType'),
                                    [ts.createTypeQueryNode(
                                        ts.createQualifiedName(
                                            ts.createQualifiedName(
                                                ts.createIdentifier(insertedName),
                                                ts.createIdentifier('computed')),
                                            ts.createIdentifier(x)))]
                                ),
                                undefined)
                        });
                        statements.unshift(
                            setZeroPos(ts.createTypeAliasDeclaration(
                                undefined,
                                undefined,
                                setZeroPos(ts.createIdentifier(computedTypeName)),
                                undefined,
                                setZeroPos(ts.createTypeLiteralNode(members))
                            ))
                        );
                    }

                    statements.unshift(
                        setZeroPos(ts.createImportDeclaration(
                            undefined,
                            undefined,
                            setZeroPos(ts.createImportClause(undefined,
                                ts.createNamedImports(
                                    [ts.createImportSpecifier(
                                        ts.createIdentifier('default'),
                                        ts.createIdentifier(insertedName))]))),
                            setZeroPos(ts.createLiteral("test"))
                        ))
                    );
                }

                if (node.kind == ts.SyntaxKind.ImportDeclaration
                    || node.kind == ts.SyntaxKind.TypeAliasDeclaration
                ) {
                    return node;
                }
                if (node.kind == ts.SyntaxKind.BinaryExpression) {
                    if ((node as ts.BinaryExpression).operatorToken.kind == ts.SyntaxKind.BarToken) {
                        const filterExpression = node as ts.BinaryExpression;
                        const right = filterExpression.right;

                        if (right.kind !== ts.SyntaxKind.Identifier
                            && right.kind !== ts.SyntaxKind.CallExpression
                        ) {
                            throw "Syntax Error here";
                        }

                        const propAccess = ts.createBinary(
                            ts.visitEachChild(filterExpression.left, visit, context),
                            filterExpression.operatorToken,

                            // funtion call or identifir so we'll deal it later
                            ts.visitEachChild(right, visit, context)
                        );

                        lastNodeKind = node.kind;
                        return ts.visitEachChild(propAccess, visit, context);
                    }
                }

                if (node.kind == ts.SyntaxKind.Identifier) {
                    console.log((node as ts.Identifier).escapedText);

                    if (lastNodeKind !== ts.SyntaxKind.Identifier
                        || lastNoneIdentifierNodeKind !== ts.SyntaxKind.PropertyAccessExpression
                    ) {
                        const propertyNode = node as ts.Identifier;
                        const propertyName = propertyNode.escapedText as string;

                        console.log('insert instance identifier', propertyNode.escapedText);
                        let insertNode: ts.Expression;
                        if (dataKeys && dataKeys.includes(propertyName)) {
                            insertNode = ts.createPropertyAccess(
                                ts.createIdentifier(insertedName),
                                ts.createIdentifier('data')
                            );
                        } else if (computedKeys && computedKeys.includes(propertyName)) {
                            insertNode = ts.createParen(
                                ts.createAsExpression(
                                    ts.createObjectLiteral(undefined, false),
                                    ts.createTypeReferenceNode(ts.createIdentifier(computedTypeName), undefined)
                                ));
                        } else if (initDataReturnKeys && initDataReturnKeys.includes(propertyName)) {
                            insertNode = ts.createParen(
                                ts.createAsExpression(
                                    ts.createObjectLiteral(undefined, false),
                                    ts.createTypeReferenceNode(ts.createIdentifier(initDataReturnTypeName), undefined)
                                ));
                        } else {
                            // others
                            insertNode = ts.createIdentifier(insertedName);
                        }

                        const propAccess = ts.createPropertyAccess(
                            insertNode,
                            node as ts.Identifier);
                        lastNodeKind = node.kind;
                        return propAccess;
                    }
                } else {
                    lastNodeKind = node.kind;
                    lastNoneIdentifierNodeKind = node.kind;
                }
                return ts.visitEachChild(node, visit, context);
            }
            return ts.visitNode(rootNode, visit);
        }
    }
}

function findIdentifierNodeAtLocation<T extends ts.Node>(offset: number, result: { lastVisited: ts.Node }) {
    return function (context: ts.TransformationContext) {
        return function (rootNode: T) {
            function visit(node: ts.Node): ts.Node {
                if (node.pos >= 0 && node.end >= 0 && node.pos < node.end) {

                    // console.log(ts.SyntaxKind[node.kind], node.pos, node.end, !!node.parent);

                    if (node.pos > offset) {
                        return node;
                    }
                    if (node.end < offset) {
                        return node;
                    }

                    // console.log('replace lastVisited', node.getText());

                    result.lastVisited = node;
                }

                return ts.visitEachChild(node, visit, context);
            }
            return ts.visitNode(rootNode, visit);
        }
    }
}


function findIdentifierNodeAtLocationInAst(sourceFile: ts.SourceFile, offset: number) {
    const lastVisited = { lastVisited: undefined as ts.Node };
    ts.transform<ts.SourceFile>(sourceFile, [findIdentifierNodeAtLocation(offset, lastVisited)]);
    return lastVisited.lastVisited;
}

interface SimpleFileInMemory {
    files: { [fileName: string]: { body: string, version: number } };
    addFile: (fileName: string, content: string) => void;
}

const myServiceHost: ts.LanguageServiceHost & SimpleFileInMemory = {
    files: {},
    addFile(this: ts.LanguageServiceHost & SimpleFileInMemory, fileName: string, body: string) {
        this.files[fileName] = {
            body,
            version: 0
        };
    },

    directoryExists(path: string) {
        console.log('look for dir', path);
        return true;
    },
    fileExists(this: ts.LanguageServiceHost & SimpleFileInMemory, path: string) {
        console.log('look for file', path);
        return !!this.files[path];
    },
    getCompilationSettings() {
        return {
            allowNonTsExtensions: true,
            allowJs: true,
            lib: ['lib.dom.d.ts', 'lib.es2017.d.ts'],
            target: ts.ScriptTarget.Latest,
            moduleResolution: ts.ModuleResolutionKind.NodeJs,
            module: ts.ModuleKind.CommonJS,
            jsx: ts.JsxEmit.Preserve,
            allowSyntheticDefaultImports: true
        };
    },
    getCurrentDirectory() {
        return '/';
    },
    getDefaultLibFileName: ts.getDefaultLibFilePath,
    getDirectories() {
        console.log('get directorys');

        return ['/'];
    },
    getNewLine() {
        return '\n';
    },
    getScriptFileNames() {
        return Object.keys(this.files);
    },
    getScriptKind() {
        return ts.ScriptKind.TS;
    },
    getScriptSnapshot(this: ts.LanguageServiceHost & SimpleFileInMemory, fileName: string) {
        const file = this.files[fileName];
        let text: string;
        if (!file) {
            if (fs.existsSync(fileName)) {
                text = fs.readFileSync(fileName, 'utf8');
            }
        } else {
            text = file.body;
        }
        return {
            getText: (start, end) => text.substring(start, end),
            getLength: () => {
                console.log('getLength', fileName);

                return text.length;
            },
            getChangeRange: () => void 0
        };
    },
    getScriptVersion(this: ts.LanguageServiceHost & SimpleFileInMemory, path: string) {
        if (this.files[path]) {
            return this.files[path].version + '';
        }
        return '0';
    },
    readDirectory(path: string) {
        console.log('read directory', path);
        return [];
    },
    readFile(this: ts.LanguageServiceHost & SimpleFileInMemory, fileName: string) {
        const text = this.files[fileName].body;
        return text;
    },
    resolveModuleNames(moduleNames: string[], containingFile: string): ts.ResolvedModule[] {
        console.log('resolveModuleNames', moduleNames, containingFile);

        return [{
            resolvedFileName: 'test.ts'
        }];
    },
};
const originCreateServiceSourceFile = ts.createLanguageServiceSourceFile;
const originUpdateServiceSourceFile = ts.updateLanguageServiceSourceFile;


function modifySourceFile(sourceFile: ts.SourceFile) {
    if (instanceComponenetInfoInserter) {
        return ts.transform<ts.SourceFile>(sourceFile,
            [instanceComponenetInfoInserter]).transformed[0];
    } else {
        return sourceFile;
    }
}

myServiceHost.addFile('test2.ts', `
    wtf.me.more;
    someName;
    someCaculateYes['numberProp'];
    someProp | someFilter;
    someNumber + someCaculateYes.numberProp;
    1 * (someNumber - someCaculateYes['numberProp']);
    (iJust, WannaTry);
    a.c.b ? some : more;
    functionCall(some);
    functionCall("some");
`);
myServiceHost.addFile(`test.ts`, `
export default {
    initData() {
        return {
            wtf: {
                me: 1
            }
        };
    },
    filters: {
        someCaculateYes(): void
    },
    doClick() {
        console.log(1);
    },
    doOtherClick() {
        return { some: 1};
    },
};
`);

Object.defineProperties(ts, {
    createLanguageServiceSourceFile: {
        configurable: false,
        get() {
            console.log('get createLanguageServiceSourceFile');
            return function createLanguageServiceSourceFile(
                fileName: string,
                scriptSnapshot: ts.IScriptSnapshot,
                scriptTarget: ts.ScriptTarget,
                version: string,
                setNodeParents: boolean,
                scriptKind?: ts.ScriptKind
            ): ts.SourceFile {
                const sourceFile = originCreateServiceSourceFile(fileName, scriptSnapshot, scriptTarget, version, setNodeParents, scriptKind);

                console.log('hook sourcefile', fileName);

                if (fileName == 'test2.ts') {
                    console.log('yes hooked', fileName);
                    const transformed = modifySourceFile(sourceFile);
                    const printer = ts.createPrinter();
                    console.log('------------');
                    console.log(printer.printFile(transformed));
                    console.log('------------');
                    return transformed;
                }

                console.log('not hooked', fileName);

                return sourceFile;
            };
        },
        set(handler: (
            fileName: string,
            scriptSnapshot: ts.IScriptSnapshot,
            scriptTarget: ts.ScriptTarget,
            version: string,
            setNodeParents: boolean,
            scriptKind?: ts.ScriptKind
        ) => ts.SourceFile) {
            console.log(new Error('set new createLanguageServiceSourceFile').stack);
        }
    },
    updateLanguageServiceSourceFile: {
        configurable: false,
        get() {
            console.log('get updateLanguageServiceSourceFile');
            return function (sourceFile: ts.SourceFile, scriptSnapshot: ts.IScriptSnapshot, version: string, textChangeRange: ts.TextChangeRange, aggressiveChecks?: boolean): ts.SourceFile {
                sourceFile = originUpdateServiceSourceFile(sourceFile, scriptSnapshot, version, textChangeRange, aggressiveChecks);
                console.log('hook sourcefile update', sourceFile.fileName);

                if (sourceFile.fileName == 'test2.ts') {
                    console.log('yes hooked update', sourceFile.fileName);
                    const transformed = modifySourceFile(sourceFile);
                    const printer = ts.createPrinter();
                    console.log('------------');
                    console.log(printer.printFile(transformed));
                    console.log('------------');
                    return transformed;
                }
                return sourceFile;
            };
        },
        set() {
            console.log(new Error('set new updateLanguageServiceSourceFile').stack);
        }
    }
});

const myService = ts.createLanguageService(myServiceHost);
const instanceComponentInfoProvider = getComponentInfoProvider(myService.getProgram(), 'test.ts');
const instanceComponenetInfoInserter = insectComponentInfo(insertedName, instanceComponentInfoProvider);
myServiceHost.files['test2.ts'].version += 1;

// const myFuncType = instanceComponentInfoProvider.getPropertyType('doOtherClick');
// console.log('++++++++++++');
// console.log(myFuncType);
// console.log('++++++++++++');

const myProgram = myService.getProgram();
const myChecker = myProgram.getTypeChecker();


const transformedFile = myProgram.getSourceFile('test2.ts');

const printer = ts.createPrinter();

console.log('-------------');
ts.transform(transformedFile.statements[0], [nodeTypeLogger]);
console.log('-------------');
console.log(printer.printFile(transformedFile));
console.log('-------------');


const lastVisited = findIdentifierNodeAtLocationInAst(transformedFile, 5);
console.log(lastVisited);
const myType = myChecker.getTypeAtLocation(lastVisited);
console.log(myType);


const testInstance = {
    initData() {
        return {
            me: 1
        };
    },
    computed: {
        some(): string {
            return '';
        }
    }
};

const myInstance = San.defineComponent(testInstance);

type DataType<T> = T extends San.ComponentConstructor<infer U, {}> ? U : never;
type OtherType<T> = T extends San.ComponentConstructor<{}, infer U> ? U : never;

type myDataType = DataType<typeof myInstance>;
type myOtherType = OtherType<typeof myInstance>;
const myComputedObject = ({} as myOtherType).computed;

type computedSome = ReturnType<typeof myComputedObject.some>;

type myType = ReturnType<typeof testInstance.initData>;
({} as myType).me;
type myComputedType = {
    some: ReturnType<typeof myComputedObject.some>
};
({} as myDataType).me;
({} as myComputedType).some;


function logCodeAst(code: string) {
    console.log('---------');
    const instanceDataInsertor = ts.createSourceFile('test.ts', code, ts.ScriptTarget.ES5);
    ts.transform<ts.Statement>(instanceDataInsertor.statements[0], [nodeTypeLogger]);
}

function logAstCode(ast: ts.Node) {
    console.log('---------');
    console.log(printer.printNode(ts.EmitHint.Unspecified, ast, undefined));
}

setZeroPosed

const createAsExpression = setZeroPosed(ts.createAsExpression);
const createBinary = setZeroPosed(ts.createBinary);
const createConditionalTypeNode = setZeroPosed(ts.createConditionalTypeNode);
const createIdentifier = setZeroPosed(ts.createIdentifier);
const createImportClause = setZeroPosed(ts.createImportClause);
const createImportDeclaration = setZeroPosed(ts.createImportDeclaration);
const createImportSpecifier = setZeroPosed(ts.createImportSpecifier);
const createInferTypeNode = setZeroPosed(ts.createInferTypeNode);
const createKeywordTypeNode = setZeroPosed(ts.createKeywordTypeNode);
const createLanguageServiceSourceFile = setZeroPosed(ts.createLanguageServiceSourceFile);
const createLiteral = setZeroPosed(ts.createLiteral);
const createNamedImports = setZeroPosed(ts.createNamedImports);
const createNamespaceImport = setZeroPosed(ts.createNamespaceImport);
const createObjectLiteral = setZeroPosed(ts.createObjectLiteral);
const createParen = setZeroPosed(ts.createParen);
const createPropertyAccess = setZeroPosed(ts.createPropertyAccess);
const createPropertySignature = setZeroPosed(ts.createPropertySignature);
const createQualifiedName = setZeroPosed(ts.createQualifiedName);
const createSourceFile = setZeroPosed(ts.createSourceFile);
const createTypeAliasDeclaration = setZeroPosed(ts.createTypeAliasDeclaration);
const createTypeLiteralNode = setZeroPosed(ts.createTypeLiteralNode);
const createTypeParameterDeclaration = setZeroPosed(ts.createTypeParameterDeclaration);
const createTypeQueryNode = setZeroPosed(ts.createTypeQueryNode);
const createTypeReferenceNode = setZeroPosed(ts.createTypeReferenceNode);
const createVariableDeclaration = setZeroPosed(ts.createVariableDeclaration);
const createVariableDeclarationList = setZeroPosed(ts.createVariableDeclarationList);
const createVariableStatement = setZeroPosed(ts.createVariableStatement);


logCodeAst('import * as San from "san"');
logCodeAst('type DataType<T> = T extends San.ComponentConstructor<infer U, {}> ? U : never;');
logCodeAst('type OtherType<T> = T extends San.ComponentConstructor<{}, infer U> ? U : never;');
logCodeAst('type instanceDataType = DataType<typeof instance>;');
logCodeAst('type instanceOtherType = OtherType<typeof instance>;');
logCodeAst('const myComputedObject = ({} as myOtherType).computed;');
logCodeAst('San.defineComponent({})');

logAstCode(
    createVariableStatement(
        undefined,
        createVariableDeclarationList(
            [
                createVariableDeclaration(
                    createIdentifier('myComputedObject'),
                    undefined,
                    createPropertyAccess(
                        createParen(
                            createAsExpression(
                                createObjectLiteral(),
                                createTypeReferenceNode(
                                    createIdentifier('myOtherType'),
                                    undefined
                                )
                            )
                        ),
                        createIdentifier('computed'))
                )
            ],
            ts.NodeFlags.Const
        )
    )
);

logAstCode(createTypeAliasDeclaration(
    undefined,
    undefined,
    createIdentifier('instanceDataType'),
    undefined,
    createTypeReferenceNode(
        createIdentifier('DataType'),
        [createTypeQueryNode(
            createIdentifier('instance')
        )]
    )
));

logAstCode(createTypeAliasDeclaration(
    undefined,
    undefined,
    createIdentifier('DataType'),
    [createTypeParameterDeclaration(
        createIdentifier('T'),
        undefined,
        undefined,
    )],
    createConditionalTypeNode(
        createTypeReferenceNode(
            createIdentifier('T'),
            undefined
        ),
        createTypeReferenceNode(
            createQualifiedName(
                createIdentifier('San'),
                createIdentifier('createComponent')
            ),
            [createInferTypeNode(
                createTypeParameterDeclaration(
                    createIdentifier('U'))),
            createTypeLiteralNode([])]
        ),
        createTypeReferenceNode(
            createIdentifier('U'),
            undefined
        ),
        createKeywordTypeNode(ts.SyntaxKind.NeverKeyword)
    )
));

logAstCode(createTypeAliasDeclaration(
    undefined,
    undefined,
    createIdentifier('OtherType'),
    [createTypeParameterDeclaration(
        createIdentifier('T'),
        undefined,
        undefined,
    )],
    createConditionalTypeNode(
        createTypeReferenceNode(
            createIdentifier('T'),
            undefined
        ),
        createTypeReferenceNode(
            createQualifiedName(
                createIdentifier('San'),
                createIdentifier('createComponent')
            ),
            [
                createTypeLiteralNode([]),
                createInferTypeNode(
                    createTypeParameterDeclaration(
                        createIdentifier('U'))),
            ]
        ),
        createTypeReferenceNode(
            createIdentifier('U'),
            undefined
        ),
        createKeywordTypeNode(ts.SyntaxKind.NeverKeyword)
    )
));

logAstCode(createImportDeclaration(
    undefined,
    undefined,
    setZeroPos(createImportClause(undefined,
        setZeroPos(createNamespaceImport(
            createIdentifier('San')
        )))),
    setZeroPos(createLiteral('san'))
));

logAstCode(createTypeAliasDeclaration(
    undefined,
    undefined,
    createIdentifier('myType'),
    undefined,
    createTypeReferenceNode(
        createIdentifier('ReturnType'),
        [createTypeQueryNode(
            createQualifiedName(
                createIdentifier('instance'),
                createIdentifier('initData')))]
    )
));

logAstCode(createParen(
    createAsExpression(
        createObjectLiteral(undefined, false),
        createTypeReferenceNode(createIdentifier('myType'), undefined)
    )));
