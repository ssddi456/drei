import * as ts from 'typescript';
import * as path from 'path';

import { getDocumentRegions } from '../embeddedSupport';
import { TextDocument } from 'vscode-languageserver-types';
import { parse } from '../template/parser/htmlParser';
import { getComponentInfoProvider } from './findComponents';
import { insectComponentInfo } from './insertComponentInfo';
import { getWrapperRangeSetter, createImportDeclaration, createImportClause, createLiteral, createIdentifier, createNamedImports, createImportSpecifier } from './astHelper';
import { interpolationSurfix, moduleName, moduleImportAsName } from './bridge';
import { templateToInterpolationTree, interpolationTreeToSourceFIle, InterpolationTree } from '../template/services/interpolationTree';


export function isSan(filename: string): boolean {
    return path.extname(filename) === '.san';
}

export function isSanInterpolation(filename: string): boolean {
    return path.extname(path.basename(filename, '.ts')) === interpolationSurfix;
}

export function getInterpolationBasename(fileName: string): string {
    return path.basename(fileName);
}
export function getInterpolationOffset(fileName: string): number {
    return parseInt(getInterpolationBasename(fileName).split('@').pop());
}
export const forceReverseSlash = (s: string) => s.replace(/\\/g, '/');
// interpolation.ts to .san
export function getInterpolationOriginName(fileName: string): string {
    const dirname = path.dirname(fileName);
    return forceReverseSlash(dirname + '/' + getInterpolationBasename(fileName).split('@').slice(0, -1).join('@') + '.san');
}
// something like some.san to  some@133.__interpolation__.ts
export function createInterpolationFileName(fileName: string) {
    const dirname = path.dirname(fileName);
    const basename = path.basename(fileName, '.san');

    return forceReverseSlash(dirname + '/' + basename + '@0' + interpolationSurfix + '.ts');
}

export function parseSan(text: string): string {
    const doc = TextDocument.create('test://test/test.san', 'san', 0, text);
    const regions = getDocumentRegions(doc);
    const script = regions.getEmbeddedDocumentByType('script');
    return script.getText() || 'export default {};';
}

export function parseSanInterpolation(text: string): string {
    const doc = TextDocument.create('test://test/test.san', 'san', 0, text);
    const regions = getDocumentRegions(doc);
    const template = regions.getEmbeddedDocumentByType('template');
    const htmlDocument = parse(template.getText());
    const interpolationTree = templateToInterpolationTree(text, htmlDocument);


    console.log(
        `------------------------
${JSON.stringify(interpolationTree, null, 2)} 
------------------------`);
    return interpolationTree.text;
}

function isTSLike(scriptKind: ts.ScriptKind | undefined) {
    return scriptKind === ts.ScriptKind.TS || scriptKind === ts.ScriptKind.TSX;
}
interface languageserverInfo {
    program: ts.Program;
}

export function createUpdater(languageserverInfo: languageserverInfo) {
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
            shouldModify(sourceFile, scriptKind, languageserverInfo.program);

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
            shouldModify(sourceFile, scriptKind, languageserverInfo.program);
            return sourceFile;
        }
    };
}

function shouldModify(sourceFile: ts.SourceFile, scriptKind: ts.ScriptKind, program: ts.Program) {
    if (isSan(sourceFile.fileName) || isSanInterpolation(sourceFile.fileName)) {
        console.log('shouldModify', sourceFile.fileName, isSan(sourceFile.fileName), isSanInterpolation(sourceFile.fileName));
    }

    if (isSan(sourceFile.fileName) && !isTSLike(scriptKind)) {
        modifySanSource(sourceFile);
    } else if (isSanInterpolation(sourceFile.fileName)) {
        modifySanInterpolationSource(sourceFile, program);
    }
}

function modifySanInterpolationSource(sourceFile: ts.SourceFile, program: ts.Program): void {
    const fileName = sourceFile.fileName;
    const originFileName = getInterpolationOriginName(fileName);

    console.log('here we modifySanInterpolationSource', fileName, originFileName);

    const infoProvider = getComponentInfoProvider(program, originFileName);
    
    sourceFile.getFullText();

    // do transform here
    interpolationTreeToSourceFIle(({} as InterpolationTree), sourceFile, infoProvider.getMemberKeys());


    console.log('so i havent reach here');
    const printer = ts.createPrinter();
    console.log(
        `the new source file
${printer.printFile(sourceFile)}`);

}

function modifySanSource(sourceFile: ts.SourceFile): void {
    console.log('modifySanSource', sourceFile.fileName);

    const statement = sourceFile.statements.find(
        st =>
            st.kind === ts.SyntaxKind.ExportAssignment &&
            (st as ts.ExportAssignment).expression.kind === ts.SyntaxKind.ObjectLiteralExpression
    );
    if (statement) {
        const exportDefaultObject = statement as ts.ExportAssignment;
        // 1. add `import San from 'san'
        //    (the span of the inserted statement must be (0,0) to avoid overlapping existing statements)


        const statements: Array<ts.Statement> = sourceFile.statements as any;
        statements.unshift(createImportDeclaration(
            undefined,
            undefined,
            createImportClause(undefined,
                createNamedImports(
                    [createImportSpecifier(
                        createIdentifier('default'),
                        createIdentifier(moduleImportAsName))]
                )),
            createLiteral(moduleName)
        ) as ts.Statement);

        // 2. find the export default and wrap it in `__sanEditorBridge(...)` if it exists and is an object literal
        // (the span of the function construct call and *all* its members must be the same as the object literal it wraps)
        const objectLiteral = exportDefaultObject.expression as ts.ObjectLiteralExpression;
        const setObjPos = getWrapperRangeSetter(objectLiteral);
        const setObjStartPos = getWrapperRangeSetter({ pos: objectLiteral.pos, end: objectLiteral.pos + 1 });
        const san = setObjStartPos(ts.createIdentifier(moduleImportAsName));

        exportDefaultObject.expression = setObjPos(ts.createCall(san, undefined, [objectLiteral]));
        setObjPos((exportDefaultObject.expression as ts.CallExpression).arguments!);
    }
    const printer = ts.createPrinter();
    console.log(
        `the new source file
${printer.printFile(sourceFile)}`);
}

