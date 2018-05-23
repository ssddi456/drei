import * as fs from 'fs';
import { TextDocument } from 'vscode-languageserver-types';

import { getJavascriptMode } from './javascript';
import { getLanguageModelCache } from '../languageModelCache';
import { getDocumentRegions } from '../embeddedSupport';
import { createInterpolationFileName } from './preprocess';
import { logger } from '../../utils/logger';

process.on('uncaughtException', function (e: Error) {
    console.log(e);

    setTimeout(() => {
        process.exit();
    }, 1);
});
logger.clear();
logger.setup();

const documentRegions = getLanguageModelCache(10, 60, document => getDocumentRegions(document));
// const workspace = path.resolve(__dirname, '../../../test/fixtures/');
const workspace = 'D:\\gitchunk\\san_demo\\';
const scriptMode = getJavascriptMode(documentRegions, workspace);

const fileBaseName = 'test5';
const originDocument = TextDocument.create(
    'file:///d%3A/gitchunk/san_demo/source/' + fileBaseName + '.san',
    'san',
    0,
    fs.readFileSync('D:\\gitchunk\\san_demo\\source\\' + fileBaseName + '.san', 'utf8')
);

const testTsName = 'test5_test';
const originTsDocument = TextDocument.create(
    'file:///d%3A/gitchunk/san_demo/source/' + testTsName + '.ts',
    'typescript',
    0,
    fs.readFileSync('D:\\gitchunk\\san_demo\\source\\' + testTsName + '.ts', 'utf8')
);

const pos = { line: 18, character: 18 };

const insertedDocument = TextDocument.create(
    createInterpolationFileName('file:///d%3A/gitchunk/san_demo/source/' + fileBaseName + '.san'),
    'typescript',
    0,
    originDocument.getText()
);

// const hoverPos = { line: 16, character: 15 };
// console.log('origin offset', originTsDocument.offsetAt(hoverPos));
// const hovers = scriptMode.doHover!(originTsDocument, hoverPos);
// console.log('hovers', hovers);

console.log('origin offset', originDocument.offsetAt(pos));
const hovers = scriptMode.doHover!(originDocument, pos);
console.log('hovers', hovers);

// console.log('origin offset', insertedDocument.offsetAt(pos));
// const hovers = scriptMode.doHover!(insertedDocument, pos);
// console.log('hovers', hovers);

// const defs = scriptMode.findDefinition!(insertedDocument, pos);
// console.log('defs', defs);

setTimeout(function () {
    process.exit(0);
}, 0);
