import * as ts from 'typescript';
import * as path from 'path';

import Uri from 'vscode-uri';
import { getDocumentRegions, SanDocumentRegions } from '../embeddedSupport';
import { TextDocument } from 'vscode-languageserver-types';
import { parse } from '../template/parser/htmlParser';
import { getComponentInfoProvider } from './findComponents';
import { getWrapperRangeSetter, createImportDeclaration, createImportClause, createLiteral, createIdentifier, createNamedImports, createImportSpecifier, setExternalModuleIndicator } from './astHelper';
import { interpolationSurfix, moduleName, moduleImportAsName } from './bridge';
import { templateToInterpolationTree, interpolationTreeToSourceFIle } from '../template/services/interpolationTree';
import { LanguageModelCache } from '../languageModelCache';
import { logger } from '../../utils/logger';

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
    return parseInt(getInterpolationBasename(fileName).split('@').pop()!);
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

export function parseSanInterpolation(text: string, foolDoc: boolean = true): string {
    if (foolDoc) {
        const doc = TextDocument.create('test://test/test.san', 'san', 0, text);
        const regions = getDocumentRegions(doc);
        const template = regions.getEmbeddedDocumentByType('template');
        text = template.getText();
    }

    logger.log(() =>
        `------------------------
text: ${text}
------------------------`);

    return templateToInterpolationTree(text, parse(text)).text!;
}

function isTSLike(scriptKind: ts.ScriptKind | undefined) {
    return scriptKind === ts.ScriptKind.TS || scriptKind === ts.ScriptKind.TSX;
}

export interface LanguageserverInfo {
    program: ts.Program;
    documentRegions: LanguageModelCache<SanDocumentRegions>
}

export function createUpdater(languageserverInfo: LanguageserverInfo) {
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
            scriptKind: ts.ScriptKind
        ): ts.SourceFile {

            const sourceFile = clssf(fileName, scriptSnapshot, scriptTarget, version, setNodeParents, scriptKind);
            scriptKindTracker.set(sourceFile, scriptKind);
            shouldModify(sourceFile, scriptKind, languageserverInfo);

            return sourceFile;
        },
        updateLanguageServiceSourceFile(
            sourceFile: ts.SourceFile,
            scriptSnapshot: ts.IScriptSnapshot,
            version: string,
            textChangeRange: ts.TextChangeRange,
            aggressiveChecks?: boolean
        ): ts.SourceFile {

            const scriptKind = scriptKindTracker.get(sourceFile)!;
            sourceFile = ulssf(sourceFile, scriptSnapshot, version, textChangeRange, aggressiveChecks);
            shouldModify(sourceFile, scriptKind, languageserverInfo);
            return sourceFile;
        }
    };
}

function shouldModify(sourceFile: ts.SourceFile, scriptKind: ts.ScriptKind, languageserverInfo: LanguageserverInfo) {
    if (isSan(sourceFile.fileName) && !isTSLike(scriptKind)) {
        modifySanSource(sourceFile);
    } else if (isSanInterpolation(sourceFile.fileName)) {
        modifySanInterpolationSource(sourceFile, languageserverInfo);
    }
}

function modifySanInterpolationSource(
    sourceFile: ts.SourceFile,
    languageserverInfo: LanguageserverInfo
): void {
    const fileName = sourceFile.fileName;
    const originFileName = getInterpolationOriginName(fileName);
    const source = sourceFile.getFullText();


    const infoProvider = getComponentInfoProvider(languageserverInfo.program, originFileName);
    const template = languageserverInfo.documentRegions.get(TextDocument.create(
        Uri.file(originFileName).toString(),
        'san',
        0,
        ''
    )).getEmbeddedDocumentByType('template');

    logger.log(() => `here we modifySanInterpolationSource 
fileName ${fileName} 
originFileName ${originFileName}
${source}
++ ++ ++ ++ ++ ++
${template.getText()}`);

    const interpolationTree = templateToInterpolationTree(source, parse(template.getText()));
    // do transform here
    interpolationTreeToSourceFIle(interpolationTree, sourceFile, infoProvider.getMemberKeys());

    setExternalModuleIndicator(sourceFile);

    logger.log(() => {
        const printer = ts.createPrinter();
        return `the new source file
${printer.printFile(sourceFile)}`
    });

}

function modifySanSource(sourceFile: ts.SourceFile): void {
    logger.log(() => ['modifySanSource', sourceFile.fileName]);

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

    setExternalModuleIndicator(sourceFile);

    logger.log(() => {
        const printer = ts.createPrinter();
        return `the new source file
${printer.printFile(sourceFile)}`
    });

}

