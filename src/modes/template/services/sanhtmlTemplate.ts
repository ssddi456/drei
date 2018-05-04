import * as fs from 'fs';
import * as ts from 'typescript';
import * as San from 'san';

import { parse } from '../parser/htmlParser';
import { logger } from '../../../utils/logger';
import { getWrapperRangeSetter, wrapSetPos } from '../../script/astHelper';
import { templateToInterpolationTree, interpolationTreeToSourceFIle } from './interpolationTree';

Error.stackTraceLimit = 100;
Error.prototype.stackTraceLimit = 100;

logger.clear();

let testSanTemplate = '';
testSanTemplate = `
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

// testSanTemplate = `<div s-for="a, c in b['some']"></div>`;
const myDoc = parse(testSanTemplate);
// const myDoc = parse(testSanTemplate);




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

const printer = ts.createPrinter();


// const myInstance = San.defineComponent(testInstance);
// const source = San.compileToSource(myInstance);
// console.log('--source--');
// console.log(source);
// console.log('--source--');
// type DataType<T> = T extends San.ComponentConstructor<infer U, {}> ? U : never;
// type OtherType<T> = T extends San.ComponentConstructor<{}, infer U> ? U : never;

// type myDataType = DataType<typeof myInstance>;
// type myOtherType = OtherType<typeof myInstance>;
// const myComputedObject = ({} as myOtherType).computed;

// type computedSome = ReturnType<typeof myComputedObject.some>;

// type myType = ReturnType<typeof testInstance.initData>;
// ({} as myType).me;
// type myComputedType = {
//     some: ReturnType<typeof myComputedObject.some>
// };
// ({} as myDataType).me;
// ({} as myComputedType).some;


function logCodeAst(code: string) {
    console.log('---------');
    const instanceDataInsertor = ts.createSourceFile('test.ts', code, ts.ScriptTarget.ES5);
    ts.transform<ts.Statement>(instanceDataInsertor.statements[0], [nodeTypeLogger]);
}

function logAstCode(ast: ts.Node) {
    console.log('---------');
    console.log(printer.printNode(ts.EmitHint.Unspecified, ast, undefined));
}

const setStartPosed = getWrapperRangeSetter({ pos: -1, end: -1 });
const setZeroPosed = wrapSetPos(setStartPosed);

const instance = San.defineComponent({
    computed: {
        normalizedScale() {
            return 123;
        },
        klass() {
            return 113322;
        }
    }
});
type DataType<T> = T extends San.ComponentConstructor<infer U, any> ? U : never;
type OtherType<T> = T extends San.ComponentConstructor<any, infer U> ? U : never;
type instanceDataType = DataType<typeof instance>;
({} as instanceDataType);
type instanceOtherType = OtherType<typeof instance>;
({} as instanceOtherType);
const instanceComputedObject = ({} as instanceOtherType).computed;
type computedTypeName = {
    normalizedScale: ReturnType<typeof instanceComputedObject.normalizedScale>;
    klass: ReturnType<typeof instanceComputedObject.klass>;
};
const testB = ({} as computedTypeName);
testB.klass
// logCodeAst('import * as San from "san"');
// logCodeAst('type DataType<T> = T extends San.ComponentConstructor<infer U, any> ? U : never;');
// logCodeAst('type OtherType<T> = T extends San.ComponentConstructor<any, infer U> ? U : never;');
// logCodeAst('type instanceDataType = DataType<typeof instance>;');
// logCodeAst('type instanceOtherType = OtherType<typeof instance>;');
// logCodeAst('const myComputedObject = ({} as myOtherType).computed;');
// logCodeAst('San.defineComponent({})');
logCodeAst(`for(let i = 0; i < arr.length;i ++) {
    doSomethings();
}`);


const magic_idx = '__i';
logAstCode(
    ts.createFor(
        ts.createVariableDeclarationList(
            [ts.createVariableDeclaration(
                ts.createIdentifier(magic_idx),
                undefined,
                ts.createNumericLiteral('0')
            )],
            ts.NodeFlags.Let
        ),
        ts.createBinary(
            ts.createIdentifier(magic_idx),
            ts.SyntaxKind.LessThanToken,
            ts.createPropertyAccess(
                ts.createIdentifier('arr'),
                ts.createIdentifier('length')
            )
        ),
        ts.createPostfixIncrement(
            ts.createIdentifier(magic_idx)
        ),
        ts.createBlock(
            [
                ts.createVariableStatement(
                    undefined,
                    ts.createVariableDeclarationList(
                        [
                            ts.createVariableDeclaration(
                                ts.createIdentifier('p'),
                                undefined,
                                ts.createElementAccess(
                                    ts.createIdentifier('arr'),
                                    ts.createIdentifier(magic_idx),
                                )
                            ),
                            ts.createVariableDeclaration(
                                ts.createIdentifier('i'),
                                undefined,
                                ts.createIdentifier(magic_idx),
                            ),
                        ],
                        ts.NodeFlags.Const
                    )
                ),

                // nested  statments goes here
                ts.createStatement(
                    ts.createCall(
                        ts.createIdentifier('doSomethings'),
                        undefined,
                        []
                    )
                ),

            ],
            true,
        )
    )
);

// logAstCode(
//     createVariableStatement(
//         undefined,
//         createVariableDeclarationList(
//             [
//                 createVariableDeclaration(
//                     createIdentifier('myComputedObject'),
//                     undefined,
//                     createPropertyAccess(
//                         createParen(
//                             createAsExpression(
//                                 createObjectLiteral(),
//                                 createTypeReferenceNode(
//                                     createIdentifier('myOtherType'),
//                                     undefined
//                                 )
//                             )
//                         ),
//                         createIdentifier('computed'))
//                 )
//             ],
//             ts.NodeFlags.Const
//         )
//     )
// );

// logAstCode(createTypeAliasDeclaration(
//     undefined,
//     undefined,
//     createIdentifier('instanceDataType'),
//     undefined,
//     createTypeReferenceNode(
//         createIdentifier('DataType'),
//         [createTypeQueryNode(
//             createIdentifier('instance')
//         )]
//     )
// ));

// logAstCode(createTypeAliasDeclaration(
//     undefined,
//     undefined,
//     createIdentifier('DataType'),
//     [createTypeParameterDeclaration(
//         createIdentifier('T'),
//         undefined,
//         undefined,
//     )],
//     createConditionalTypeNode(
//         createTypeReferenceNode(
//             createIdentifier('T'),
//             undefined
//         ),
//         createTypeReferenceNode(
//             createQualifiedName(
//                 createIdentifier('San'),
//                 createIdentifier('createComponent')
//             ),
//             [createInferTypeNode(
//                 createTypeParameterDeclaration(
//                     createIdentifier('U'))),
//             createKeywordTypeNode(ts.SyntaxKind.AnyKeyword)
//         ),
//         createTypeReferenceNode(
//             createIdentifier('U'),
//             undefined
//         ),
//         createKeywordTypeNode(ts.SyntaxKind.NeverKeyword)
//     )
// ));

// logAstCode(createTypeAliasDeclaration(
//     undefined,
//     undefined,
//     createIdentifier('OtherType'),
//     [createTypeParameterDeclaration(
//         createIdentifier('T'),
//         undefined,
//         undefined,
//     )],
//     createConditionalTypeNode(
//         createTypeReferenceNode(
//             createIdentifier('T'),
//             undefined
//         ),
//         createTypeReferenceNode(
//             createQualifiedName(
//                 createIdentifier('San'),
//                 createIdentifier('createComponent')
//             ),
//             [
//                 createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
//                 createInferTypeNode(
//                     createTypeParameterDeclaration(
//                         createIdentifier('U'))),
//             ]
//         ),
//         createTypeReferenceNode(
//             createIdentifier('U'),
//             undefined
//         ),
//         createKeywordTypeNode(ts.SyntaxKind.NeverKeyword)
//     )
// ));

// logAstCode(createImportDeclaration(
//     undefined,
//     undefined,
//     setZeroPos(createImportClause(undefined,
//         setZeroPos(createNamespaceImport(
//             createIdentifier('San')
//         )))),
//     setZeroPos(createLiteral('san'))
// ));

// logAstCode(createTypeAliasDeclaration(
//     undefined,
//     undefined,
//     createIdentifier('myType'),
//     undefined,
//     createTypeReferenceNode(
//         createIdentifier('ReturnType'),
//         [createTypeQueryNode(
//             createQualifiedName(
//                 createIdentifier('instance'),
//                 createIdentifier('initData')))]
//     )
// ));

// logAstCode(createParen(
//     createAsExpression(
//         createObjectLiteral(undefined, false),
//         createTypeReferenceNode(createIdentifier('myType'), undefined)
//     )));



const myInterpolationTree = templateToInterpolationTree(testSanTemplate, myDoc);

console.log(JSON.stringify(myInterpolationTree, null, 2));

const newSource = interpolationTreeToSourceFIle(myInterpolationTree);
const newPrinter = ts.createPrinter();
console.log(newPrinter.printFile(newSource));



const keys = Object.keys({});

function randomIcon() {
    return keys[Math.floor(Math.random() * keys.length)]
}

const b = San.defineComponent({
    initData() {
        return {
            logo: randomIcon(),
            list: [1, 2, 3, 4, 5,],
            running: true
        }
    },
    components: {
        icon: {}
    },
    change() {
        this.data.set('logo', randomIcon())
    },
    toggle() {
        this.data.set('running', !this.data.get('running'))
    },
    // attached() {
    //     setInterval(() => {
    //         if (this.data.get('running')) {
    //             this.change()
    //         }
    //     }, 200)
    // }
});

interface SanComponentConfigProp<T, D> {
    data: Partial<T>;
    test(this: Component<T> & D): string;
}

class Component<T> {
    constructor(config: { data: T }) {

    }
}

type FunctionPropertyNames<T> = { [K in keyof T]: T[K] extends Function ? K : never }[keyof T];
type SanComponentConfigPropKey = keyof SanComponentConfigProp<any, any>;

type ExtendedProperties<T> = Pick<T, Exclude<keyof T, keyof SanComponentConfigProp<any, any>>>;

function defineComponent<T, D, F extends SanComponentConfigProp<T, D>, G = ExtendedProperties<F>>
    (config: F): Component<T> & G {

    return new Component({ data: config.data }) as Component<T> & G;

}

type cbbData = {
    someObject: number,
};
type cbbMethods = {
    yes: (this: Component<cbbData> & cbbMethods) => number;
}
type cbbType = SanComponentConfigProp<
    cbbData,
    cbbMethods
    > & cbbMethods;

const cbb: cbbType = {
    data: {
        someObject: 1,
    },
    yes() {
        return 1;
    },
    test() {
        this
        return '1';
    }
}
type funcMembers = ExtendedProperties<typeof cbb>;

// so finally i must create generic the type info
// by myself ( wtf.... )
const abb = defineComponent(cbb)


