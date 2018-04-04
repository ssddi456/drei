import * as fs from 'fs';
; import * as path from 'path';
import * as ts from 'typescript';
import { getComponentInfoProvider } from "./../../script/findComponents";
import { ComponentInfoProvider } from "./../../script/findComponents";
import { Node, parse } from '../parser/htmlParser';
import { setZeroPos } from '../../script/preprocess';



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
                console.log(node.escapedText);
            }

            return ts.visitEachChild(node, visit, context);
        }
        return ts.visitNode(rootNode, visit);
    }
}

const insertedName = 'instance';
const initDataReturnTypeName = 'initDataReturnTypeName';
const computedTypeName = 'computedTypeName';

function getMemberKeys(objectType: ts.Type): string[] {
    return objectType ? Array.from(objectType.members.keys()) : undefined;
}
function insectComponentInfo(insertedName: string, inforProvider: ComponentInfoProvider) {

    const dataProperties = inforProvider ? inforProvider.getPropertyType('data') : undefined;
    // or the return type of initData
    const dataKeys = getMemberKeys(dataProperties);

    const initDataMethodType = (inforProvider ? inforProvider.getPropertyType('initData') : undefined) as ts.ObjectType;
    const initDataReturnType = (initDataMethodType && (initDataMethodType.objectFlags & ts.ObjectFlags.Anonymous)) ?
        inforProvider.checker.getSignaturesOfType(initDataMethodType, ts.SignatureKind.Call)[0].getReturnType() : undefined;
    const initDataReturnKeys = getMemberKeys(initDataReturnType);

    // get computed data type should get its return type
    const computedProperties = inforProvider ? inforProvider.getPropertyType('computed') : undefined;
    const computedKeys = getMemberKeys(computedProperties);

    const filterProperties = inforProvider ? inforProvider.getPropertyType('filters') : undefined;
    const filterKeys = getMemberKeys(filterProperties);

    const allMembers = inforProvider ? inforProvider.defaultExportType.members as Map<string, ts.Symbol> : undefined;
    const allMemberKeys = allMembers ? Array.from(allMembers.keys()) : [];

    console.log('dataKeys', dataKeys);
    console.log('initDataReturnKeys', initDataReturnKeys);
    console.log('computedKeys', computedKeys);
    console.log('filterKeys', filterKeys);
    console.log('allMemberKeys', allMemberKeys);

    const allMemberFunctionKeys: string[] = [];
    for (let i = 0; i < allMemberKeys.length; i++) {
        const symbol = allMembers.get(allMemberKeys[i]);

        if (symbol.flags & ts.SymbolFlags.Method) {
            allMemberFunctionKeys.push(allMemberKeys[i]);
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
        console.log('getScriptVersion', path);
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
const instanceComponentInfoProvider = getComponentInfoProvider(myService, 'test.ts');
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


type myType = ReturnType<typeof testInstance.initData>;
({} as myType).me;
type myComputedType = {
    some: ReturnType<typeof testInstance.computed.some>
};
({} as myComputedType).some;


console.log('---------');
const instanceDataInsertor = ts.createSourceFile('test.ts', 'instance.data', ts.ScriptTarget.ES5);
ts.transform<ts.Statement>(instanceDataInsertor.statements[0], [nodeTypeLogger]);

console.log('---------');
const instanceInitDataTypeInsertor = ts.createSourceFile('test.ts', 'type myType = ReturnType<typeof instance.initData>;', ts.ScriptTarget.ES5);
ts.transform<ts.Statement>(instanceInitDataTypeInsertor.statements[0], [nodeTypeLogger]);

console.log(JSON.stringify(instanceInitDataTypeInsertor.statements[0], null, 2));

console.log('---------');
const instanceInitDataInsertor = ts.createSourceFile('test.ts', '({} as myType).me', ts.ScriptTarget.ES5);
ts.transform<ts.Statement>(instanceInitDataInsertor.statements[0], [nodeTypeLogger]);

console.log('---------');
const computedDatInsertor = ts.createSourceFile('test.ts', 'type myComputedType = { some: ReturnType<typeof testInstance.computed.some>}', ts.ScriptTarget.ES5);
ts.transform<ts.Statement>(computedDatInsertor.statements[0], [nodeTypeLogger]);

console.log('---------');
const myExpr = ts.createTypeAliasDeclaration(
    undefined,
    undefined,
    ts.createIdentifier('myType'),
    undefined,
    ts.createTypeReferenceNode(
        ts.createIdentifier('ReturnType'),
        [ts.createTypeQueryNode(
            ts.createQualifiedName(
                ts.createIdentifier('instance'),
                ts.createIdentifier('initData')))]
    )
);
console.log(printer.printNode(ts.EmitHint.Unspecified, myExpr, undefined));

console.log('---------');
const myObjectExpr = ts.createParen(
    ts.createAsExpression(
        ts.createObjectLiteral(undefined, false),
        ts.createTypeReferenceNode(ts.createIdentifier('myType'), undefined)
    ));
console.log(printer.printNode(ts.EmitHint.Unspecified, myObjectExpr, undefined));
console.log('---------');
const myComputedExpr = ts.createTypeAliasDeclaration(
    undefined,
    undefined,
    ts.createIdentifier('myType'),
    undefined,
    ts.createTypeLiteralNode(
        [
            ts.createPropertySignature(
                undefined,
                ts.createIdentifier('some'),
                undefined,
                ts.createTypeReferenceNode(
                    ts.createIdentifier('ReturnType'),
                    [ts.createTypeQueryNode(
                        ts.createQualifiedName(
                            ts.createQualifiedName(
                                ts.createIdentifier('instance'),
                                ts.createIdentifier('initData')),
                            ts.createIdentifier('some')))]
                ),
                undefined)
        ]
    )
);
console.log(printer.printNode(ts.EmitHint.Unspecified, myComputedExpr, undefined));
