import { HTMLDocument } from '../parser/htmlParser';
import { TokenType, createScanner } from '../parser/htmlScanner';
import { TextDocument, Range, Position, Hover, MarkedString } from 'vscode-languageserver-types';
import { IHTMLTagProvider } from '../tagProviders';
import { NULL_HOVER } from '../../nullMode';
import { REG_SAN_DIRECTIVE, REG_SAN_INTERPOLATIONS } from '../../script/bridge';

const TRIVIAL_TOKEN = [TokenType.StartTagOpen, TokenType.EndTagOpen, TokenType.Whitespace];

export function doHover(
    document: TextDocument,
    position: Position,
    htmlDocument: HTMLDocument,
    tagProviders: IHTMLTagProvider[]
): Hover {
    const offset = document.offsetAt(position);
    const node = htmlDocument.findNodeAt(offset);
    if (!node) {
        return NULL_HOVER;
    }
    function getTagHover(tag: string, range: Range, open: boolean): Hover {
        tag = tag.toLowerCase();
        for (const provider of tagProviders) {
            let hover: Hover | null = null;
            provider.collectTags((t, label) => {
                if (t === tag) {
                    const tagLabel = open ? '<' + tag + '>' : '</' + tag + '>';
                    hover = { contents: [{ language: 'html', value: tagLabel }, MarkedString.fromPlainText(label)], range };
                }
            });
            if (hover) {
                return hover;
            }
        }
        return NULL_HOVER;
    }

    function getAttributeHover(tag: string, attribute: string, range: Range): Hover {
        tag = tag.toLowerCase();
        let hover: Hover = NULL_HOVER;
        for (const provider of tagProviders) {
            provider.collectAttributes(tag, (attr, type, documentation, alias) => {
                if (attribute !== attr && attribute !== alias) {
                    return;
                }
                const contents = [documentation ? MarkedString.fromPlainText(documentation) : `No doc for ${attr}`];
                hover = { contents, range };
            });
        }
        return hover;
    }

    const inEndTag = node.endTagStart && offset >= node.endTagStart; // <html></ht|ml>
    const startOffset = inEndTag ? node.endTagStart : node.start;
    const scanner = createScanner(document.getText(), startOffset);
    let token = scanner.scan();

    function shouldAdvance() {
        if (token === TokenType.EOS) {
            return false;
        }
        const tokenEnd = scanner.getTokenEnd();
        if (tokenEnd < offset) {
            return true;
        }

        if (tokenEnd === offset) {
            return TRIVIAL_TOKEN.includes(token);
        }
        return false;
    }

    let lastAttrName: string;

    while (shouldAdvance()) {
        token = scanner.scan();
        if (token == TokenType.AttributeName) {
            lastAttrName = scanner.getTokenText();
        }
    }

    console.log('hover token', token, scanner.getTokenText());

    if (offset > scanner.getTokenEnd()) {
        return NULL_HOVER;
    }
    const tagRange = {
        start: document.positionAt(scanner.getTokenOffset()),
        end: document.positionAt(scanner.getTokenEnd())
    };
    switch (token) {
        case TokenType.StartTag:
            return node.tag ? getTagHover(node.tag, tagRange, true) : NULL_HOVER;
        case TokenType.EndTag:
            return node.tag ? getTagHover(node.tag, tagRange, false) : NULL_HOVER;
        case TokenType.AttributeName:
            const attributeToGetNameInfo = scanner.getTokenText();
            return node.tag ? getAttributeHover(node.tag, attributeToGetNameInfo, tagRange) : NULL_HOVER;
        case TokenType.AttributeValue:
            // TODO: provide type info for bindings
            const attributeToGetValueInfo = scanner.getTokenText();
            if (lastAttrName.match(REG_SAN_DIRECTIVE) || attributeToGetValueInfo.match(REG_SAN_INTERPOLATIONS)) {
                console.log('san-html text', document.getText());
                return { contents: [`content for san directive ${lastAttrName}`], range: tagRange };
            }
            return NULL_HOVER;
        case TokenType.InterpolationContent:
            return { contents: [`content for san interpolition`], range: tagRange };
    }

    return NULL_HOVER;
}
