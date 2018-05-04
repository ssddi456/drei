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

// suite('integrated test', () => {
//   const filenames = glob.sync(workspace + '/**/*.san');
//   for (const filename of filenames) {
//     const doc = createTextDocument(filename);
//     const diagnostics = scriptMode.doValidation!(doc);
//     test('validate: ' + path.basename(filename), () => {
//       assert(diagnostics.length === 0);
//     });
//     if (filename.endsWith('app.san')) {
//       const components = scriptMode.findComponents(doc);
//       test('props collection', testProps.bind(null, components));
//     }
//   }
// });
const originDocument = TextDocument.create(
    'file:///d%3A/gitchunk/san_demo/source/icon.san',
    'san',
    0,
    fs.readFileSync('D:\\gitchunk\\san_demo\\source\\icon.san', 'utf8')
);
const pos = { line: 10, character: 15 };

// const pos = {
//     line: 24,
//     character: 15
// };

const offset = originDocument.offsetAt(pos);

console.log('offset', offset);
console.log('text', originDocument.getText().slice(Math.max(offset - 10, 0), offset + 10));

const insertedDocument = TextDocument.create(
    createInterpolationFileName('file:///d%3A/gitchunk/san_demo/source/icon.san'),
    'typescript',
    0,
    originDocument.getText()
);

setTimeout(function () {
    // const validate = scriptMode.doValidation(originDocument);
    // const hovers = scriptMode.doHover(insertedDocument, pos);
    // const hovers = scriptMode.doHover!(originDocument, pos);
    const defs = scriptMode.findDefinition!(insertedDocument, pos);

    // console.log('hovers', hovers);
    console.log('defs', defs);

    setTimeout(function () {
        process.exit(0);
    }, 0);
},0);




