import * as assert from 'assert';
import * as path from 'path';
import * as glob from 'glob';
import * as util from 'util';
import * as fs from 'fs';
import { TextDocument } from 'vscode-languageserver-types';
import Uri from 'vscode-uri';

import { getJavascriptMode } from './javascript';
import { getLanguageModelCache } from '../languageModelCache';
import { getDocumentRegions } from '../embeddedSupport';
import { ComponentInfo } from './findComponents';
import { createInterpolationFileName } from './preprocess';
import { logger } from '../../utils/logger';


process.on('uncaughtException', function (e: Error) {
    console.log(e);

    setTimeout(() => {
        process.exit();
    }, 1);
});
logger.clear()
console.log('yes i startup!');

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
    'file:///d%3A/gitchunk/san_demo/source/test2.san',
    'san',
    0,
    fs.readFileSync('D:/gitchunk/san_demo/source/test2.san', 'utf8')
);
const pos = { line: 13, character: 26 };

// const pos = {
//     line: 24,
//     character: 15
// };

const offset = originDocument.offsetAt(pos);

console.log('offset', offset);
console.log('text', originDocument.getText().slice(Math.max(offset - 10, 0), offset + 10));

const insertedDocument = TextDocument.create(
    createInterpolationFileName('file:///d%3A/gitchunk/san_demo/source/test2.san', offset),
    'typescript',
    0,
    originDocument.getText()
);

setTimeout(function () {
    const validate = scriptMode.doValidation(originDocument);
    // const hovers = scriptMode.doHover(insertedDocument, pos);
    const hovers = scriptMode.doHover(originDocument, pos);
    // const defs = scriptMode.findDefinition(originDocument, pos);

    console.log('hovers', hovers);
    // console.log('defs', defs);

    setTimeout(function () {
        process.exit(0);
    }, 0);
}, 3000);


function testProps(components: ComponentInfo[]) {
    assert.equal(components.length, 4, 'component number');
    const comp = components[0];
    const comp2 = components[1];
    const comp3 = components[2];
    const comp4 = components[3];
    assert.equal(comp.name, 'comp', 'component name');
    assert.equal(comp2.name, 'comp2', 'component name');
    assert.deepEqual(comp.props, [{ name: 'propname' }, { name: 'another-prop' }]);
    assert.deepEqual(comp2.props, [
        { name: 'propname', doc: 'String' },
        { name: 'weird-prop', doc: '' },
        { name: 'another-prop', doc: 'type: Number' }
    ]);
    assert.deepEqual(comp3.props, [{ name: 'inline' }]);
    assert.deepEqual(comp4.props, [{ name: 'inline', doc: 'Number' }]);
}

function createTextDocument(filename: string): TextDocument {
    const uri = Uri.file(filename).toString();
    const content = fs.readFileSync(filename, 'utf-8');
    return TextDocument.create(uri, 'san', 0, content);
}
