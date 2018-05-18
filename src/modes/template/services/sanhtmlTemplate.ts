import * as fs from 'fs';
import { logCodeAst } from "./../../script/astHelper";
import { forceReverseSlash } from "./../../script/preprocess";
import * as ts from 'typescript';

import { logger } from '../../../utils/logger';
import { getComponentInfoProvider } from '../../script/findComponents';
import { logAstCode } from '../../script/astHelper';

Error.stackTraceLimit = 100;
Error.prototype.stackTraceLimit = 100;

logger.clear();
logger.setup();

const testSanTemplate = `
    <div>
        <div s-if="false">
            <div class="{{ wtf }}   {{another wtf}}  " s-if="{{someMessage}}">lets make a test {{one}}</div>
            <button value="{= myValue =}" on-click="increase"> incress </button>
        </div>
        <div s-for="y in z['f']">
            <div s-for="a in b" s-if="a.xxx">
                <div s-for="d,e in a.some" title="{{d.text}}"> {{d.text}} {{d.some}}</div>
            </div>
        </div>
    </div>
`;






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
    doClick( e: Event ) {
        console.log(1);
    },
    doOtherClick(this: {}) {
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
                }

                console.log('not hooked', fileName);

                return sourceFile;
            };
        },
        set() {
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
                }
                return sourceFile;
            };
        },
        set() {
            console.log(new Error('set new updateLanguageServiceSourceFile').stack);
        }
    }
});



/**
 * so 
 * 1. create a shadow ts file for js file
 * 2. insert type info for the shadow file
 * 3. make a symbol map for the inserted types with real type
 */
const reservedConfigMethodNames = [
    'initData',
    'compiled',
    'inited',
    'created',
    'attached',
    'detached',
    'disposed',
    'updated',
];

logCodeAst('const a = function (this: San.defineComponent<test> & {})  { return 1 }');
// 这里忽略类型参数的问题
function typeNodeFromString(typeString: string) {
    const tempSourceFile = ts.createSourceFile('test.ts', 'type myType = ' + typeString, ts.ScriptTarget.ES5);
    const tempType = tempSourceFile.statements[0] as ts.TypeAliasDeclaration;
    return tempType.type;
}

function transSnJstoSanTs(program: ts.Program, filename: string): ts.SourceFile {
    /**
     * 
     * type DataType = {}
     * type MethodType = {
     *      methodName(this: ComponentType, ...) : ....
     * }
     * type ComponentType = San.SanComponent<DataType> & MethodType
     * 
     */
    const componentInfo = getComponentInfoProvider(program, filename);
    const source = program.getSourceFile(filename)!;

    const uuid = '';
    const unicExportName = 'componentExports__' + uuid;

    const uniqDataTypeName = 'componentDataType__' + uuid;
    const uniqMethodTypeName = 'componentMethodType__' + uuid;
    const uniqComponentType = 'componentComponentType__' + uuid;

    let dataProperty = componentInfo.getPropertyType('data');
    const initDataProperty = componentInfo.getPropertyType('initData') as ts.ObjectType;;

    if (!dataProperty) {
        if (initDataProperty) {
            dataProperty = (initDataProperty && (initDataProperty.objectFlags & ts.ObjectFlags.Anonymous)) ?
                componentInfo.checker.getSignaturesOfType(initDataProperty, ts.SignatureKind.Call)[0].getReturnType() : null as ts.Type;
        }
    }
    // make data type here
    const dataTypeString = dataProperty ? componentInfo.checker.typeToString(dataProperty) : '';
    function getDataTypeNode() {
        return dataTypeString ? typeNodeFromString(dataTypeString) : ts.createTypeLiteralNode([]);
    }
    logger.log(() => ['dataTypeString', dataTypeString]);

    // make methods type here

    const methodKeys = componentInfo.getMemberKeys().allMemberFunctionKeys.filter(x => reservedConfigMethodNames.indexOf(x) === -1);
    function getMethodTypeNode() {
        return methodKeys.length
            ? ts.createTypeLiteralNode(methodKeys.map(x => {
                const methodType = componentInfo.getPropertyType(x);

                const methodTypeNode = typeNodeFromString(
                    componentInfo.checker.typeToString(
                        methodType)) as ts.FunctionTypeNode;

                const parameters = methodTypeNode.parameters;
                const signature = (componentInfo.checker.getSignaturesOfType(
                    methodType, ts.SignatureKind.Call
                )[0] as any) as ts.MethodSignature;
                const thisParameter = signature.thisParameter;

                console.log('signature', x, signature);
                console.log('thisParameter', x, thisParameter);

                if (!thisParameter) {
                    ((parameters as any) as ts.ParameterDeclaration[]).unshift(
                        ts.createParameter(
                            undefined,
                            undefined,
                            undefined,
                            ts.createIdentifier('this'),
                            undefined,

                            ts.createTypeReferenceNode(
                                ts.createIdentifier(uniqComponentType),
                                undefined
                            )
                        ));
                }
                return ts.createPropertySignature(
                    undefined,
                    ts.createIdentifier(x),
                    undefined,
                    methodTypeNode,
                    undefined);
            }))
            : ts.createTypeLiteralNode([]);
    }
    // so we can solve everything

    function modify<T extends ts.Node>(context: ts.TransformationContext) {
        return function (rootNode: T): ts.Node {

            let defaultExportVisitCount = 0;

            function visit(node: ts.Node): ts.Node {
                if (node.kind == ts.SyntaxKind.ExportAssignment) {
                    const exportNode = node as ts.ExportAssignment;
                    console.log('exportNode.name', exportNode.name);

                    if (defaultExportVisitCount > 0) {
                        return node;
                    }
                    defaultExportVisitCount++;
                    return ts.createVariableDeclarationList(
                        [ts.createVariableDeclaration(
                            ts.createIdentifier(unicExportName),
                            ts.createTypeReferenceNode(
                                ts.createQualifiedName(
                                    ts.createIdentifier('San'),
                                    ts.createIdentifier('SanComponentConfig')
                                ),
                                [
                                    ts.createTypeReferenceNode(
                                        ts.createIdentifier(uniqDataTypeName),
                                        undefined
                                    ),
                                    ts.createTypeReferenceNode(
                                        ts.createIdentifier(uniqMethodTypeName),
                                        undefined),
                                ]
                            ), // we need make a expression here
                            exportNode.expression
                        )],
                        ts.NodeFlags.Const
                    );

                } else if (node.kind == ts.SyntaxKind.SourceFile) {
                    const sourceFileNode = node as ts.SourceFile;
                    const statements = (sourceFileNode.statements as any) as ts.Node[];

                    statements.unshift(ts.createImportDeclaration(
                        undefined,
                        undefined,
                        ts.createImportClause(undefined,
                            ts.createNamespaceImport(
                                ts.createIdentifier('San')
                            )),
                        ts.createLiteral('san')
                    ));

                    statements.push(ts.createTypeAliasDeclaration(
                        undefined,
                        undefined,
                        ts.createIdentifier(uniqDataTypeName),
                        undefined,
                        getDataTypeNode()
                    ));
                    statements.push(ts.createTypeAliasDeclaration(
                        undefined,
                        undefined,
                        ts.createIdentifier(uniqMethodTypeName),
                        undefined,
                        getMethodTypeNode()
                    ));
                    statements.push(ts.createTypeAliasDeclaration(
                        undefined,
                        undefined,
                        ts.createIdentifier(uniqComponentType),
                        undefined,
                        ts.createIntersectionTypeNode([
                            ts.createTypeReferenceNode(
                                ts.createQualifiedName(
                                    ts.createIdentifier('San'),
                                    ts.createIdentifier('SanComponent')
                                ),
                                [
                                    ts.createTypeReferenceNode(
                                        ts.createIdentifier(uniqDataTypeName),
                                        undefined
                                    ),
                                ]
                            ),
                            ts.createTypeReferenceNode(
                                ts.createIdentifier(uniqMethodTypeName),
                                undefined
                            )
                        ])
                    ));

                    statements.push(
                        ts.createExportDefault(
                            ts.createCall(
                                ts.createPropertyAccess(
                                    ts.createIdentifier('San'),
                                    ts.createIdentifier('defineComponent'),
                                ),
                                [
                                    ts.createTypeReferenceNode(
                                        ts.createIdentifier(uniqDataTypeName),
                                        undefined),
                                    ts.createTypeReferenceNode(
                                        ts.createIdentifier(uniqMethodTypeName),
                                        undefined),
                                ], // we will set our type arguments here
                                [
                                    ts.createIdentifier(unicExportName)
                                ])
                        ));
                    return ts.visitEachChild(node, visit, context);
                }

                return node;
            }
            return ts.visitNode(rootNode, visit);
        }
    }

    return ts.transform(source, [modify]).transformed[0] as ts.SourceFile;
}

const myService = ts.createLanguageService(myServiceHost);
const myProgram = myService.getProgram();

// logAstCode(transSnJstoSanTs(myProgram, 'test.ts'));

logCodeAst(`
type testType = typeof instance.data
`);

logCodeAst(`
type testType = typeof instance.computed
`);
