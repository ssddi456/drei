import { CompletionTestSetup, testDSL } from '../../test-util/completion-test-util';

import { parseHTMLDocument } from '../parser/htmlParser';
import { doComplete } from '../services/htmlCompletion';
import { TextDocument, Position } from 'vscode-languageserver';

const setup: CompletionTestSetup = {
  langId: 'san-html',
  docUri: 'test://test/test.html',
  doComplete(doc:TextDocument, pos: Position) {
    const htmlDoc = parseHTMLDocument(doc);
    return doComplete(doc, pos, htmlDoc, [], {});
  }
};

const sanHtml = testDSL(setup);

suite('Emmet Completion', () => {
  test('Emmet HTML Expansion', () => {
    sanHtml`ul>li*3|`.has(`ul>li*3`).become(
      `<ul>
\t<li>\${1}</li>
\t<li>\${2}</li>
\t<li>\${0}</li>
</ul>`
    );

    sanHtml`{{ul>li*3|}}`.hasNo(`ul>li*3`);

    sanHtml`div+p|`.has(`div+p`).become(
      `<div>\${1}</div>
<p>\${0}</p>`
    );
  });

  sanHtml`#header|`.has(`#header`).become(`<div id="header">\${0}</div>`);
});
