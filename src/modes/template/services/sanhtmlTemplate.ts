import * as ts from 'typescript';
import { createScanner, TokenType } from '../parser/htmlScanner';
import { REG_SAN_INTERPOLATIONS, REG_SAN_DIRECTIVE } from '../../script/bridge';
import { HTMLDocument, Node } from '../parser/htmlParser';
import { isEmptyElement } from '../tagProviders/htmlTags';
import * as util from "util";

interface SanExpression {
    isInterpolation: boolean;
    directive?: string;
    event?: string;
    scopedValue?: string;
    start: number;
    end: number;
}

type SanAttribute = string | SanExpression

class SanNode extends Node {
    Attributes?: {
        [k: string]: SanAttribute
    }
}

interface SanHTMLDocument extends HTMLDocument {
    roots: SanNode[];
    findNodeBefore(offset: number): SanNode;
    findNodeAt(offset: number): SanNode;
}

function parse(text: string): SanHTMLDocument {
    console.log('parse start ----\n' + text  + '\n-----');

    const scanner = createScanner(text);

    const htmlDocument = new Node(0, text.length, [], null as any);
    let curr = htmlDocument;
    let endTagStart = -1;
    let pendingAttribute = '';
    let token = scanner.scan();
    let attributes: { [k: string]: SanAttribute } | undefined = {};
    while (token !== TokenType.EOS) {
        switch (token) {
            case TokenType.StartTagOpen:
                const child = new Node(scanner.getTokenOffset(), text.length, [], curr);
                curr.children.push(child);
                curr = child;
                break;
            case TokenType.StartTag:
                curr.tag = scanner.getTokenText();
                break;
            case TokenType.StartTagClose:
                curr.end = scanner.getTokenEnd(); // might be later set to end tag position
                if (isEmptyElement(curr.tag) && curr !== htmlDocument) {
                    curr.closed = true;
                    curr = curr.parent;
                }
                break;
            case TokenType.EndTagOpen:
                endTagStart = scanner.getTokenOffset();
                break;
            case TokenType.EndTag:
                const closeTag = scanner.getTokenText().toLowerCase();
                while (!curr.isSameTag(closeTag) && curr !== htmlDocument) {
                    curr.end = endTagStart;
                    curr.closed = false;
                    curr = curr.parent;
                }
                if (curr !== htmlDocument) {
                    curr.closed = true;
                    curr.endTagStart = endTagStart;
                }
                break;
            case TokenType.StartTagSelfClose:
                if (curr !== htmlDocument) {
                    curr.closed = true;
                    curr.end = scanner.getTokenEnd();
                    curr = curr.parent;
                }
                break;
            case TokenType.EndTagClose:
                if (curr !== htmlDocument) {
                    curr.end = scanner.getTokenEnd();
                    curr = curr.parent;
                }
                break;
            case TokenType.StartInterpolation: {
                const child = new Node(scanner.getTokenOffset(), text.length, [], curr);
                child.isInterpolation = true;
                curr.children.push(child);
                curr = child;
                break;
            }
            case TokenType.EndInterpolation:
                curr.end = scanner.getTokenEnd();
                curr.closed = true;
                curr = curr.parent;
                break;
            case TokenType.InterpolationContent:
                console.log('interpolation content', scanner.getTokenText());
                break;

            case TokenType.AttributeName:
                pendingAttribute = scanner.getTokenText();
                attributes = curr.attributes;
                if (!attributes) {
                    curr.attributes = attributes = {};
                }
                attributes[pendingAttribute] = ''; // Support valueless attributes such as 'checked'
                break;
            case TokenType.AttributeValue:
                const value = scanner.getTokenText();
                const startWithQuote = value[0].match(/"|'/);
                const valueWithOutQuate = startWithQuote ? value.slice(1, -1) : value;

                const attributeValueStart = startWithQuote ? scanner.getTokenOffset() + 1: scanner.getTokenOffset();
                const attributeValueEnd = startWithQuote ? scanner.getTokenEnd() - 1: scanner.getTokenEnd();

                if (attributes && pendingAttribute) {
                    if (pendingAttribute.match(REG_SAN_DIRECTIVE)) {
                        const attributeNode: SanExpression = attributes[pendingAttribute] = {
                            isInterpolation: false,
                            start: attributeValueStart,
                            end: scanner.getTokenEnd(),
                            value,
                        };
                        const directiveInfo = pendingAttribute.match(REG_SAN_DIRECTIVE);
                        const prefix = directiveInfo[1];

                        if (prefix === 's' || prefix === 'san') {
                            if( directiveInfo[2] == 'if' 
                                || directiveInfo[2] == 'elif'
                                || directiveInfo[2] == 'html'
                            ) {
                                if( valueWithOutQuate.indexOf('{{') === -1  ){
                                    const interpolationDocument = parse('{{' + valueWithOutQuate + '}}');

                                    interpolationDocument.roots.forEach(function( node ) {
                                        node.start += attributeValueStart - 2;
                                        node.end += attributeValueStart - 2;

                                        node.parent = curr;
                                        curr.children.push(node);
                                    });
                                } else {
                                    const interpolationDocument = parse(valueWithOutQuate);

                                    interpolationDocument.roots.forEach(function( node ) {
                                        node.start += attributeValueStart;
                                        node.end += attributeValueStart;

                                        node.parent = curr;
                                        curr.children.push(node);
                                    });
                                }
                            } else if (prefix == 'for') {
                                valueWithOutQuate.replace(/^(\s*)([\$0-9a-z_]+)((\s*,\s*)([\$0-9a-z_]+))?(\s+in\s+)(\S+)\s*/ig, 
                                    function($, $1, $item, $3, $4, $index, $5, $accesor) {

                                        const itemStart = attributeValueStart + ($1 || '').length;
                                        const itemNode = new Node(itemStart, itemStart + $item.length, [], curr)
                                        itemNode.isInterpolation = true;
                                        curr.children.push(itemNode);

                                        if($index) {
                                            const indexStart = attributeValueStart + [$1 || '', $item, $4 || ''].join('').length;
                                            const indexNode = new Node( indexStart, indexStart + $index.length, [], curr)
                                            indexNode.isInterpolation = true;
                                            curr.children.push(indexNode);
                                        }

                                        const iteratorStart = attributeValueStart + [$1 || '', $item, $3 || '', $6 || ''].join('').length
                                        const iteratorNode = new Node( iteratorStart, iteratorStart + $accesor.length, [], curr);
                                        iteratorNode.isInterpolation = true;
                                        curr.children.push(iteratorNode);
                                    });
                            }

                            attributeNode.directive = directiveInfo[2];
                        } else if (prefix == 'on') {
                            attributeNode.event = directiveInfo[2];

                            const eventNode = new Node(attributeValueStart, attributeValueEnd, [], curr);
                            eventNode.isInterpolation = true;
                            curr.children.push(eventNode);

                        } else if (prefix == 'var') {
                            attributeNode.scopedValue = directiveInfo[2];

                            const eventNode = new Node(attributeValueStart, attributeValueEnd, [], curr);
                            eventNode.isInterpolation = true;
                            curr.children.push(eventNode);
                        }

                    } else if (valueWithOutQuate.match(REG_SAN_INTERPOLATIONS)) {
                        const interpolationDocument =  parse(valueWithOutQuate);

                        interpolationDocument.roots.forEach(function( node ) {
                            node.start += attributeValueStart;
                            node.end += attributeValueStart;

                            node.parent = curr;
                            curr.children.push(node);
                        });

                        attributes[pendingAttribute] = value;
                    } else {
                        attributes[pendingAttribute] = value;
                    }
                    pendingAttribute = '';
                }
                break;
        }
        token = scanner.scan();
    }
    while (curr !== htmlDocument) {
        curr.end = text.length;
        curr.closed = false;
        curr = curr.parent;
    }
    return {
        roots: htmlDocument.children,
        findNodeBefore: htmlDocument.findNodeBefore.bind(htmlDocument),
        findNodeAt: htmlDocument.findNodeAt.bind(htmlDocument)
    };
}


const testSanTemplate = `
    <div>
        <div class="{{ wtf }}   {{another wtf}}  ">lets make a test {{one}}</div>
        <button value="{= myValue =}" on-click="increase"> incress </button>
    </div>
`;
// const testSanTemplate = `{{wtf}}`

const myDoc = parse(testSanTemplate);

function removeParent( node ) {
    node.parent= undefined;
    node.children.forEach(removeParent);
}

myDoc.roots.forEach(removeParent);

console.log( JSON.stringify(myDoc, null, 2) );
function getTextContent (node, source) {
    console.log('---------------\n' + source.slice(node.start, node.end) + '\n---------------');
    node.children.forEach(function(node) {
        getTextContent (node, source);
    });
}

myDoc.roots.forEach(function(node) {
    getTextContent(node, testSanTemplate);
});
