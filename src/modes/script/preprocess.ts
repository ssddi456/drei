import * as ts from 'typescript';
import * as path from 'path';

import Uri from 'vscode-uri';
import { getDocumentRegions, SanDocumentRegions } from '../embeddedSupport';
import { TextDocument } from 'vscode-languageserver-types';
import { parse } from '../template/parser/htmlParser';
import { getComponentInfoProvider, getComponentInfoProviderFromSourceFile } from './findComponents';
import { getWrapperRangeSetter, createImportDeclaration, createImportClause, createLiteral, createIdentifier, createNamedImports, createImportSpecifier, setExternalModuleIndicator, endPos, endZeroPos, setPosAstTree } from './astHelper';
import { interpolationSurfix, moduleName, moduleImportAsName, shadowTsSurfix } from './bridge';
import { templateToInterpolationTree, interpolationTreeToSourceFile } from '../template/services/interpolationTree';
import { LanguageModelCache } from '../languageModelCache';
import { logger } from '../../utils/logger';
import { insertDataTypeAndMethodsType } from './insertComponentInfo';
import { languageServiceInfo } from './serviceHost';

export function isSan(filename: string): boolean {
    return path.extname(filename) === '.san';
}

export function isSanInterpolation(filename: string): boolean {
    return path.extname(path.basename(filename, '.ts')) === interpolationSurfix;
}
export function isSanShadowTs(filename: string): boolean {
    return path.extname(path.basename(filename, '.ts')) === shadowTsSurfix;
}

export function getInterpolationBasename(fileName: string): string {
    if (isSanInterpolation(fileName)) {
        return path.basename(fileName, interpolationSurfix + '.ts');
    }
    return fileName;
}

export function getShadowTsBasename(fileName: string): string {
    if (isSanShadowTs(fileName)) {
        return path.basename(fileName, shadowTsSurfix + '.ts');
    }
    return fileName;
}

export const forceReverseSlash = (s: string) => s.replace(/\\/g, '/');
// interpolation.ts to .san
export function getInterpolationOriginName(fileName: string): string {
    const dirname = path.dirname(fileName);

    return forceReverseSlash(dirname + '/' + getInterpolationBasename(fileName) + '.san');
}
// __shadow_ts__.ts to .san
export function getShadowTsOriginName(fileName: string): string {
    const dirname = path.dirname(fileName);

    return forceReverseSlash(dirname + '/' + getShadowTsBasename(fileName) + '.san');
}

// something like some.san to  some@133.__interpolation__.ts
export function createInterpolationFileName(fileName: string) {
    const dirname = path.dirname(fileName);
    const basename = path.basename(fileName, '.san');

    return forceReverseSlash(dirname + '/' + basename + interpolationSurfix + '.ts');
}

export function createShadowTsFileName(fileName: string) {
    const dirname = path.dirname(fileName);
    const basename = path.basename(fileName, '.san');

    return forceReverseSlash(dirname + '/' + basename + shadowTsSurfix + '.ts');
}

export function getSanOriginFileName(fileName: string): string {
    if (isSanInterpolation(fileName)) {
        fileName = getInterpolationOriginName(fileName);
    } else if (isSanShadowTs(fileName)) {
        fileName = getShadowTsOriginName(fileName);
    }
    return fileName;
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
    documentRegions: LanguageModelCache<SanDocumentRegions>;
    getLanguageId(fileName: string): string;
    updateCurrentTextDocument(doc: TextDocument): {
        service: ts.LanguageService,
        scriptDoc: TextDocument
    }
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
            logger.log(() => ['createLanguageServiceSourceFile', fileName]);
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
            logger.log(() => ['updateLanguageServiceSourceFile', sourceFile.fileName]);

            const scriptKind = scriptKindTracker.get(sourceFile)!;
            sourceFile = ulssf(sourceFile, scriptSnapshot, version, textChangeRange, aggressiveChecks);
            shouldModify(sourceFile, scriptKind, languageserverInfo);
            return sourceFile;
        }
    };
}

function shouldModify(sourceFile: ts.SourceFile, scriptKind: ts.ScriptKind, languageserverInfo: LanguageserverInfo) {
    let didModify = true;
    if (isSan(sourceFile.fileName)) {
        modifySanSource(sourceFile, !isTSLike(scriptKind), languageserverInfo);
    } else if (isSanInterpolation(sourceFile.fileName)) {
        modifySanInterpolationSource(sourceFile, languageserverInfo);
    } else if (isSanShadowTs(sourceFile.fileName)) {
        // so we should modify the source code
        modifySanShadowTs(sourceFile, languageserverInfo);
    } else {
        didModify = false;
    }

    if (didModify) {
        setExternalModuleIndicator(sourceFile);

        logger.log(() => {
            const printer = ts.createPrinter();
            return `the new source file ${sourceFile.fileName}
    ${printer.printFile(sourceFile)}`
        });
    }

}

function modifySanShadowTs(
    sourceFile: ts.SourceFile,
    languageserverInfo: LanguageserverInfo
): void {

    const fileName = sourceFile.fileName;
    const originFileName = getShadowTsOriginName(fileName);

    logger.log(() => ['modifySanShadowTs', fileName]);

    insertDataTypeAndMethodsType(sourceFile,
        getComponentInfoProvider(languageserverInfo.program, originFileName));

}

function modifySanInterpolationSource(
    sourceFile: ts.SourceFile,
    languageserverInfo: LanguageserverInfo
): void {
    logger.log(() => ['modifySanInterpolationSource', sourceFile.fileName]);

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
    interpolationTreeToSourceFile(
        interpolationTree,
        sourceFile,
        infoProvider.getMemberKeys(),
        languageserverInfo.getLanguageId(originFileName) === 'javascript');

}


function addShadowTsImports(statements: ts.Statement[], containingFile: string) {

    // for san shadow ts imports
    const imports = statements.filter(
        st =>
            st.kind === ts.SyntaxKind.ImportDeclaration &&
            (st as ts.ImportDeclaration).moduleSpecifier.kind === ts.SyntaxKind.StringLiteral
    ) as ts.ImportDeclaration[];

    const containingDir = path.dirname(containingFile);
    if (imports.length) {
        imports.forEach(function (st) {
            const name = (st.moduleSpecifier as ts.StringLiteral).text;
            if (isSan(name)) {
                const sanFileName = path.resolve(containingDir, name);
                logger.log(() => ['this should check if a shadow ts file', name, containingFile, sanFileName]);
                if (languageServiceInfo.getLanguageId(sanFileName) === 'javascript') {
                    const shadowTsFileName = forceReverseSlash(
                        path.join('.',
                            path.relative(containingDir,
                                path.dirname(sanFileName) + '/' + path.basename(createShadowTsFileName(sanFileName), '.ts'))));

                    logger.log(() => ['modifySanSource found a shadow ts import', shadowTsFileName]);

                    const idx = statements.indexOf(st);
                    const endOfLastSt = endZeroPos(st);

                    statements.splice(idx + 1, 0,
                        setPosAstTree(
                            createImportDeclaration(
                                undefined,
                                undefined,
                                createImportClause(undefined,
                                    createNamedImports(
                                        [createImportSpecifier(
                                            createIdentifier('default'),
                                            createIdentifier('_a_module_place_holder_' + idx))]
                                    )),
                                createLiteral(shadowTsFileName)
                            ), endOfLastSt) as ts.Statement);

                }
            }
        });
    }
}

function modifySanSource(sourceFile: ts.SourceFile, isJsALike: boolean, languageserverInfo: LanguageserverInfo): void {
    logger.log(() => ['modifySanSource', sourceFile.fileName]);
    const statements: ts.Statement[] = sourceFile.statements as any;

    // may add an import for shadow ts...
    // addShadowTsImports(statements, sourceFile.fileName);

    // if (!isJsALike
    //     || !languageserverInfo.program 
    //     || !languageserverInfo.program.getSourceFile(createShadowTsFileName(sourceFile.fileName))
    // ) {
        
    // }
    return;

    // provide sanComponentConfig export
    const statement = sourceFile.statements.find(
        st =>
            st.kind === ts.SyntaxKind.ExportAssignment &&
            (st as ts.ExportAssignment).expression.kind === ts.SyntaxKind.ObjectLiteralExpression
    );

    if (statement) {
        const exportDefaultObject = statement as ts.ExportAssignment;
        // 1. add `import San from 'san'
        //    (the span of the inserted statement must be (0,0) to avoid overlapping existing statements)

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
}
