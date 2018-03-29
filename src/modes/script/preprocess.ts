import * as ts from 'typescript';
import * as path from 'path';

import { getDocumentRegions } from '../embeddedSupport';
import { TextDocument } from 'vscode-languageserver-types';
import { moduleName, moduleImportAsName } from './bridge';

export function isSan(filename: string): boolean {
    return path.extname(filename) === '.san';
}

export function parseSan(text: string): string {
    const doc = TextDocument.create('test://test/test.san', 'san', 0, text);
    const regions = getDocumentRegions(doc);
    const script = regions.getEmbeddedDocumentByType('script');
    return script.getText() || 'export default {};';
}

function isTSLike(scriptKind: ts.ScriptKind | undefined) {
    return scriptKind === ts.ScriptKind.TS || scriptKind === ts.ScriptKind.TSX;
}

export function createUpdater() {
    const clssf = ts.createLanguageServiceSourceFile;
    const ulssf = ts.updateLanguageServiceSourceFile;
    const scriptKindTracker = new WeakMap<ts.SourceFile, ts.ScriptKind | undefined>();

    return {
        createLanguageServiceSourceFile(
            fileName: string,
            scriptSnapshot: ts.IScriptSnapshot,
            scriptTarget: ts.ScriptTarget,
            version: string,
            setNodeParents: boolean,
            scriptKind?: ts.ScriptKind
        ): ts.SourceFile {
            const sourceFile = clssf(fileName, scriptSnapshot, scriptTarget, version, setNodeParents, scriptKind);
            scriptKindTracker.set(sourceFile, scriptKind);
            if (isSan(fileName) && !isTSLike(scriptKind)) {
                modifySanSource(sourceFile);
            }
            return sourceFile;
        },
        updateLanguageServiceSourceFile(
            sourceFile: ts.SourceFile,
            scriptSnapshot: ts.IScriptSnapshot,
            version: string,
            textChangeRange: ts.TextChangeRange,
            aggressiveChecks?: boolean
        ): ts.SourceFile {
            const scriptKind = scriptKindTracker.get(sourceFile);
            sourceFile = ulssf(sourceFile, scriptSnapshot, version, textChangeRange, aggressiveChecks);
            if (isSan(sourceFile.fileName) && !isTSLike(scriptKind)) {
                modifySanSource(sourceFile);
            }
            return sourceFile;
        }
    };
}

function modifySanSource(sourceFile: ts.SourceFile): void {
    const exportDefaultObject = sourceFile.statements.find(
        st =>
            st.kind === ts.SyntaxKind.ExportAssignment &&
            (st as ts.ExportAssignment).expression.kind === ts.SyntaxKind.ObjectLiteralExpression
    );
    if (exportDefaultObject) {
        // 1. add `import San from 'san'
        //    (the span of the inserted statement must be (0,0) to avoid overlapping existing statements)
        const setZeroPos = getWrapperRangeSetter({ pos: 0, end: 0 });
        const sanImport = setZeroPos(
            ts.createImportDeclaration(
                undefined,
                undefined,
                setZeroPos(ts.createImportClause(
                    undefined,
                    setZeroPos(ts.createNamespaceImport(
                        setZeroPos(ts.createIdentifier('San'))))
                )),
                setZeroPos(ts.createLiteral('san'))
            )
        );
        const statements: Array<ts.Statement> = sourceFile.statements as any;
        statements.unshift(sanImport);

        // 2. find the export default and wrap it in `__sanEditorBridge(...)` if it exists and is an object literal
        // (the span of the function construct call and *all* its members must be the same as the object literal it wraps)
        const objectLiteral = (exportDefaultObject as ts.ExportAssignment).expression as ts.ObjectLiteralExpression;
        const setObjPos = getWrapperRangeSetter(objectLiteral);
        const setObjStartPos = getWrapperRangeSetter({ pos: objectLiteral.pos, end: objectLiteral.pos + 1 });
        const san = setObjStartPos(ts.createPropertyAccess(
            setObjStartPos(ts.createIdentifier('San')),
            setObjStartPos(ts.createIdentifier('defineComponent')),
        ));

        (exportDefaultObject as ts.ExportAssignment).expression = setObjPos(ts.createCall(san, undefined, [objectLiteral]));
        setObjPos(((exportDefaultObject as ts.ExportAssignment).expression as ts.CallExpression).arguments!);
    }
    const printer = ts.createPrinter();
    console.log(
`new source 
${printer.printFile(sourceFile)}
`
    );
    
}

/** Create a function that calls setTextRange on synthetic wrapper nodes that need a valid range */
function getWrapperRangeSetter(wrapped: ts.TextRange): <T extends ts.TextRange>(wrapperNode: T) => T {
    return <T extends ts.TextRange>(wrapperNode: T) => ts.setTextRange(wrapperNode, wrapped);
}
