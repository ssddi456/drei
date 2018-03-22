import { LanguageMode } from '../languageModes';
import { doScaffoldComplete } from './scaffoldCompletion';

export function getSanMode(): LanguageMode {
  let config: any = {};

  return {
    getId() {
      return 'san';
    },
    configure(c) {
      config = c;
    },
    doComplete(document, position) {
      if (!config.drei.completion.useScaffoldSnippets) {
        return { isIncomplete: false, items: [] };
      }
      const offset = document.offsetAt(position);
      const text = document.getText().slice(0, offset);
      const needBracket = /<\w*$/.test(text);
      const ret = doScaffoldComplete();
      // remove duplicate <
      if (needBracket) {
        ret.items.forEach(item => {
          item.insertText = item.insertText!.slice(1);
        });
      }
      return ret;
    },
    onDocumentRemoved() {},
    dispose() {}
  };
}
