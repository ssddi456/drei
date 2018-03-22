import * as path from 'path';
import * as ts from 'typescript';
import Uri from 'vscode-uri';
import { TextDocument } from 'vscode-languageserver-types';
import * as parseGitIgnore from 'parse-gitignore';

import { LanguageModelCache } from '../languageModelCache';
import { createUpdater, parseSan, isSan } from './preprocess';
import { getFileFsPath, getFilePath } from '../../utils/paths';
import * as bridge from './bridge';
import * as chokidar from 'chokidar';

// Patch typescript functions to insert `import San from 'san'` and `San.createComponent` around export default.
// NOTE: this is a global hack that all ts instances after is changed
const { createLanguageServiceSourceFile, updateLanguageServiceSourceFile } = createUpdater();
(ts as any).createLanguageServiceSourceFile = createLanguageServiceSourceFile;
(ts as any).updateLanguageServiceSourceFile = updateLanguageServiceSourceFile;

const sanSys: ts.System = {
    ...ts.sys,
    fileExists(path: string) {
        if (isSanProject(path)) {
            return ts.sys.fileExists(path.slice(0, -3));
        }
        return ts.sys.fileExists(path);
    },
    readFile(path, encoding) {
        if (isSanProject(path)) {
            const fileText = ts.sys.readFile(path.slice(0, -3), encoding);
            console.log('parse san!', path);
            return fileText ? parseSan(fileText) : fileText;
        } else {
            const fileText = ts.sys.readFile(path, encoding);
            return fileText;
        }
    }
};

if (ts.sys.realpath) {
    const realpath = ts.sys.realpath;
    sanSys.realpath = function (path) {
        if (isSanProject(path)) {
            return realpath(path.slice(0, -3)) + '.ts';
        }
        return realpath(path);
    };
}

const defaultCompilerOptions: ts.CompilerOptions = {
    allowNonTsExtensions: true,
    allowJs: true,
    lib: ['lib.dom.d.ts', 'lib.es2017.d.ts'],
    target: ts.ScriptTarget.Latest,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.Preserve,
    allowSyntheticDefaultImports: true
};

export function getServiceHost(workspacePath: string, jsDocuments: LanguageModelCache<TextDocument>) {
    let currentScriptDoc: TextDocument;
    const versions = new Map<string, number>();
    const scriptDocs = new Map<string, TextDocument>();

    const parsedConfig = getParsedConfig(workspacePath);
    const files = parsedConfig.fileNames;
    const compilerOptions = {
        ...defaultCompilerOptions,
        ...parsedConfig.options
    };
    compilerOptions.allowNonTsExtensions = true;
    const watcher = chokidar.watch(workspacePath, {
        ignoreInitial: true,
        ignored: defaultIgnorePatterns(workspacePath)
    });

    watcher
        .on('change', filterNonScript(path => {
            const ver = versions.get(path) || 0;
            versions.set(path, ver + 1);
        }))
        .on('add', filterNonScript(path => {
            files.push(path);
        }));

    function updateCurrentTextDocument(doc: TextDocument) {
        const fileFsPath = getFileFsPath(doc.uri);
        const filePath = getFilePath(doc.uri);
        // When file is not in language service, add it
        if (!scriptDocs.has(fileFsPath)) {
            if (fileFsPath.endsWith('san')) {
                files.push(filePath);
            }
        }
        if (!currentScriptDoc || doc.uri !== currentScriptDoc.uri || doc.version !== currentScriptDoc.version) {
            currentScriptDoc = jsDocuments.get(doc);
            const lastDoc = scriptDocs.get(fileFsPath);
            if (lastDoc && currentScriptDoc.languageId !== lastDoc.languageId) {
                // if languageId changed, restart the language service; it can't handle file type changes
                jsLanguageService.dispose();
                jsLanguageService = ts.createLanguageService(host);
            }
            scriptDocs.set(fileFsPath, currentScriptDoc);
            versions.set(fileFsPath, (versions.get(fileFsPath) || 0) + 1);
        }
        return {
            service: jsLanguageService,
            scriptDoc: currentScriptDoc
        };
    }

    function getScriptDocByFsPath(fsPath: string) {
        return scriptDocs.get(fsPath);
    }

    const host: ts.LanguageServiceHost = {
        getCompilationSettings: () => compilerOptions,
        getScriptFileNames: () => files,
        getScriptVersion(fileName) {
            if (fileName === bridge.fileName) {
                return '0';
            }
            const normalizedFileFsPath = getNormalizedFileFsPath(fileName);
            const version = versions.get(normalizedFileFsPath);
            return version ? version.toString() : '0';
        },
        getScriptKind(fileName) {
            if (isSan(fileName)) {
                const uri = Uri.file(fileName);
                fileName = uri.fsPath;
                const doc =
                    scriptDocs.get(fileName) ||
                    jsDocuments.get(TextDocument.create(uri.toString(), 'san', 0, ts.sys.readFile(fileName) || ''));
                return getScriptKind(doc.languageId);
            } else {
                if (fileName === bridge.fileName) {
                    return ts.Extension.Ts;
                }
                // NOTE: Typescript 2.3 should export getScriptKindFromFileName. Then this cast should be removed.
                return (ts as any).getScriptKindFromFileName(fileName);
            }
        },

        // resolve @types, see https://github.com/Microsoft/TypeScript/issues/16772
        getDirectories: sanSys.getDirectories,
        directoryExists: sanSys.directoryExists,
        fileExists: sanSys.fileExists,
        readFile: sanSys.readFile,
        readDirectory: sanSys.readDirectory,

        resolveModuleNames(moduleNames: string[], containingFile: string): ts.ResolvedModule[] {
            // in the normal case, delegate to ts.resolveModuleName
            // in the relative-imported.san case, manually build a resolved filename
            return moduleNames.map(name => {
                if (name === bridge.moduleName) {
                    return {
                        resolvedFileName: bridge.fileName,
                        extension: ts.Extension.Ts
                    };
                }
                if (path.isAbsolute(name) || !isSan(name)) {
                    return ts.resolveModuleName(name, containingFile, compilerOptions, ts.sys).resolvedModule;
                }
                const resolved = ts.resolveModuleName(name, containingFile, compilerOptions, sanSys).resolvedModule;
                if (!resolved) {
                    return undefined as any;
                }
                if (!resolved.resolvedFileName.endsWith('.san.ts')) {
                    return resolved;
                }
                const resolvedFileName = resolved.resolvedFileName.slice(0, -3);
                const uri = Uri.file(resolvedFileName);
                const doc =
                    scriptDocs.get(resolvedFileName) ||
                    jsDocuments.get(TextDocument.create(uri.toString(), 'san', 0, ts.sys.readFile(resolvedFileName) || ''));
                const extension =
                    doc.languageId === 'typescript'
                        ? ts.Extension.Ts
                        : doc.languageId === 'tsx' ? ts.Extension.Tsx : ts.Extension.Js;
                return { resolvedFileName, extension };
            });
        },
        getScriptSnapshot: (fileName: string) => {
            console.log('getScriptSnapshot', fileName);
            if (fileName === bridge.fileName) {
                console.log('getScriptSnapshot san bridge file');
                
                const text = bridge.content;
                return {
                    getText: (start, end) => text.substring(start, end),
                    getLength: () => text.length,
                    getChangeRange: () => void 0
                };
            }
            const normalizedFileFsPath = getNormalizedFileFsPath(fileName);
            const doc = scriptDocs.get(normalizedFileFsPath);
            let fileText = doc ? doc.getText() : ts.sys.readFile(normalizedFileFsPath) || '';
            if (!doc && isSan(fileName)) {
                // Note: This is required in addition to the parsing in embeddedSupport because
                // this works for .san files that aren't even loaded by VS Code yet.
                console.log('parse san!', fileName);
                fileText = parseSan(fileText);
            }
            return {
                getText: (start, end) => fileText.substring(start, end),
                getLength: () => fileText.length,
                getChangeRange: () => void 0
            };
        },
        getCurrentDirectory: () => workspacePath,
        getDefaultLibFileName: ts.getDefaultLibFilePath,
        getNewLine: () => '\n'
    };

    let jsLanguageService = ts.createLanguageService(host);
    return {
        updateCurrentTextDocument,
        getScriptDocByFsPath,
        dispose: () => {
            watcher.close();
            jsLanguageService.dispose();
        },
    };
}

function getNormalizedFileFsPath(fileName: string): string {
    return Uri.file(fileName).fsPath;
}

function isSanProject(path: string) {
    return path.endsWith('.san.ts') && !path.includes('node_modules');
}

function defaultIgnorePatterns(workspacePath: string) {
    const nodeModules = ['node_modules', '**/node_modules/*'];
    const gitignore = ts.findConfigFile(workspacePath, ts.sys.fileExists, '.gitignore');
    if (!gitignore) {
        return nodeModules;
    }
    const parsed: string[] = parseGitIgnore(gitignore);
    const filtered = parsed.filter(s => !s.startsWith('!'));
    return nodeModules.concat(filtered);
}

function getScriptKind(langId: string): ts.ScriptKind {
    return langId === 'typescript' ? ts.ScriptKind.TS : langId === 'tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.JS;
}



function getParsedConfig(workspacePath: string) {
    const configFilename =
        ts.findConfigFile(workspacePath, ts.sys.fileExists, 'tsconfig.json') ||
        ts.findConfigFile(workspacePath, ts.sys.fileExists, 'jsconfig.json');
    const configJson = (configFilename && ts.readConfigFile(configFilename, ts.sys.readFile).config) || {
        exclude: defaultIgnorePatterns(workspacePath)
    };
    // existingOptions should be empty since it always takes priority
    return ts.parseJsonConfigFileContent(
        configJson,
        ts.sys,
        workspacePath,
    /*existingOptions*/ {},
        configFilename,
    /*resolutionStack*/ undefined,
        [{ extension: 'san', isMixedContent: true }]
    );
}

function filterNonScript(func: (path: string) => void) {
    return (path: string) => {
        if (!/(tsx?|san|jsx?)$/.test(path)) {
            return;
        }
        func(path);
    };
}
