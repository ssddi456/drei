import * as ts from 'typescript';
import { ComponentInfoProvider } from "./../../script/findComponents";
import { createScanner, TokenType } from '../parser/htmlScanner';
import { REG_SAN_INTERPOLATIONS, REG_SAN_DIRECTIVE } from '../../script/bridge';
import { HTMLDocument, Node } from '../parser/htmlParser';
import { isEmptyElement } from '../tagProviders/htmlTags';
import * as util from "util";

interface SanExpression {
    directive?: string;
    event?: string;

    // for val- xxx
    scopedValue?: string;

    start: number;
    end: number;

    value: string;

    // for san-for
    itemName?: string;
    indexName?: string;
    interatorName?: string;
}

type SanAttribute = string | SanExpression

class SanNode extends Node {
    parent: SanNode;
    children: SanNode[];
    sanAttributes?: {
        [k: string]: SanAttribute
    };
    scope: SanScope;
    findNodeBefore(offset: number): SanNode {
        return super.findNodeBefore(offset) as SanNode;
    }
    findNodeAt(offset: number): SanNode {
        return super.findNodeAt(offset) as SanNode;
    }
}

interface SanHTMLDocument extends HTMLDocument {
    roots: SanNode[];
    findNodeBefore(offset: number): SanNode;
    findNodeAt(offset: number): SanNode;
}

function parse(text: string): SanHTMLDocument {
    console.log('parse start ----\n' + text + '\n-----');

    const scanner = createScanner(text);

    const htmlDocument = new SanNode(0, text.length, [], null as any);
    let curr: SanNode = htmlDocument;
    let endTagStart = -1;
    let pendingAttribute = '';
    let token = scanner.scan();
    let attributes: { [k: string]: SanAttribute } | undefined = {};
    while (token !== TokenType.EOS) {
        switch (token) {
            case TokenType.StartTagOpen:
                const child = new SanNode(scanner.getTokenOffset(), text.length, [], curr);
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
                const child = new SanNode(scanner.getTokenOffset(), text.length, [], curr);
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

                const attributeValueStart = startWithQuote ? scanner.getTokenOffset() + 1 : scanner.getTokenOffset();
                const attributeValueEnd = startWithQuote ? scanner.getTokenEnd() - 1 : scanner.getTokenEnd();

                if (attributes && pendingAttribute) {
                    if (pendingAttribute.match(REG_SAN_DIRECTIVE)) {
                        curr.sanAttributes = curr.sanAttributes || {};
                        const attributeNode: SanExpression = attributes[pendingAttribute] = {
                            start: attributeValueStart,
                            end: scanner.getTokenEnd(),
                            value: valueWithOutQuate,
                        };
                        const directiveInfo = pendingAttribute.match(REG_SAN_DIRECTIVE);
                        const prefix = directiveInfo[1];

                        if (prefix === 's' || prefix === 'san') {
                            if (directiveInfo[2] == 'if'
                                || directiveInfo[2] == 'elif'
                                || directiveInfo[2] == 'html'
                            ) {
                                if (valueWithOutQuate.indexOf('{{') === -1) {
                                    const interpolationDocument = parse('{{' + valueWithOutQuate + '}}');

                                    interpolationDocument.roots.forEach(function (node) {
                                        node.start += attributeValueStart - 2;
                                        node.end += attributeValueStart - 2;

                                        node.parent = curr;
                                        curr.children.push(node);
                                    });
                                } else {
                                    const interpolationDocument = parse(valueWithOutQuate);

                                    interpolationDocument.roots.forEach(function (node) {
                                        node.start += attributeValueStart;
                                        node.end += attributeValueStart;

                                        node.parent = curr;
                                        curr.children.push(node);
                                    });
                                }
                            } else if (directiveInfo[2] == 'for') {
                                valueWithOutQuate.replace(/^(\s*)([\$0-9a-z_]+)((\s*,\s*)([\$0-9a-z_]+))?(\s+in\s+)(\S+)\s*/ig,
                                    function ($, $1, $item, $3, $4, $index, $6, $accesor) {

                                        const itemStart = attributeValueStart + ($1 || '').length;
                                        const itemNode = new SanNode(itemStart, itemStart + $item.length, [], curr)
                                        itemNode.isInterpolation = true;
                                        curr.children.push(itemNode);
                                        attributeNode.itemName = $item;

                                        if ($index) {
                                            const indexStart = attributeValueStart + [$1 || '', $item, $4 || ''].join('').length;
                                            const indexNode = new SanNode(indexStart, indexStart + $index.length, [], curr)
                                            indexNode.isInterpolation = true;
                                            curr.children.push(indexNode);
                                            attributeNode.indexName = $index;
                                        } else {
                                            attributeNode.indexName = '$index';
                                        }

                                        const iteratorStart = attributeValueStart + [$1 || '', $item, $3 || '', $6 || ''].join('').length
                                        const iteratorNode = new SanNode(iteratorStart, iteratorStart + $accesor.length, [], curr);
                                        iteratorNode.isInterpolation = true;
                                        curr.children.push(iteratorNode);
                                        attributeNode.interatorName = $accesor;


                                        return '';
                                    });
                            }

                            attributeNode.directive = directiveInfo[2];
                        } else if (prefix == 'on') {
                            attributeNode.event = directiveInfo[2];

                            const eventNode = new SanNode(attributeValueStart, attributeValueEnd, [], curr);
                            eventNode.isInterpolation = true;
                            curr.children.push(eventNode);

                        } else if (prefix == 'var') {
                            attributeNode.scopedValue = directiveInfo[2];

                            const eventNode = new SanNode(attributeValueStart, attributeValueEnd, [], curr);
                            eventNode.isInterpolation = true;
                            curr.children.push(eventNode);
                        }
                        curr.sanAttributes[pendingAttribute] = attributeNode;
                    } else if (valueWithOutQuate.match(REG_SAN_INTERPOLATIONS)) {
                        const interpolationDocument = parse(valueWithOutQuate);

                        interpolationDocument.roots.forEach(function (node) {
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

class SanScope {
    constructor(public parentScope: SanScope, public scopeContext: ComponentInfoProvider) { }
    findTypeByName(name: string): ts.Type {
        if (this.scopeContext) {
            /**
             * 先查找 data
             * 再查找 computed
             * 再查找字面属性
             */
            const dataPropType = this.scopeContext.getPropertyType('data');
            if (dataPropType) {
                const propOnData = this.scopeContext.getPropertyTypeOfType(dataPropType, name);
                if (propOnData) {
                    return propOnData;
                }
            }
            const computedPropType = this.scopeContext.getPropertyType('data');
            if (computedPropType) {
                const propOnData = this.scopeContext.getPropertyTypeOfType(computedPropType, name);
                if (propOnData) {
                    return propOnData;
                }
            }
            const propOnData = this.scopeContext.getPropertyType(name);
            if (propOnData) {
                return propOnData;
            }
        }
        if (this.parentScope) {
            return this.parentScope.findTypeByName(name);
        }
        return undefined;
    }
}

function createScope(sanNode: SanNode, currentScope: SanScope) {
    if (!sanNode.scope) {
        sanNode.scope = currentScope;
    }
    if (sanNode.children) {
        let childScope: SanScope = currentScope;
        if (sanNode.tag === 'slot') {
            // create a new top scope with propertyMap
            const propertiesMap = {} as { [k: string]: string };
            sanNode.attributeNames.filter(x => x.indexOf('var-') == 0)
                .forEach(x => {
                    const expression = sanNode.sanAttributes[x] as SanExpression;
                    propertiesMap[expression.scopedValue] = expression.value
                });
            type scopeValueProvider = ComponentInfoProvider & { propertiesMap: typeof propertiesMap };
            const scopeValueProvider: scopeValueProvider = {
                checker: currentScope.scopeContext.checker,
                propertiesMap,
                getPropertyType(this: scopeValueProvider, name: string) {
                    if (this.propertiesMap.hasOwnProperty(name)) {
                        return currentScope.scopeContext.getPropertyType(
                            this.propertiesMap[name]);
                    }
                    return undefined;
                },
                getPropertyTypeOfType(prop: ts.Type, name: string) {
                    return currentScope.scopeContext.getPropertyTypeOfType(prop, name);
                }
            };
            childScope = new SanScope(undefined, scopeValueProvider);
        }
        if (sanNode.attributeNames.filter(x => x === 's-for' || x === 'san-for').length) {
            const forExpression = sanNode.sanAttributes[sanNode.attributeNames
                .filter(x => x === 's-for' || x === 'san-for')[0]] as SanExpression;

            const scopeValueProvider: ComponentInfoProvider = {
                checker: currentScope.scopeContext.checker,
                getPropertyType(this: ComponentInfoProvider, name: string) {
                    // TODO: find type for forExpression
                    if (name == forExpression.indexName) {
                    } else if (name == forExpression.itemName) {

                    }
                    return undefined;
                },
                getPropertyTypeOfType(prop: ts.Type, name: string) {
                    return currentScope.scopeContext.getPropertyTypeOfType(prop, name);
                }
            };
            childScope = new SanScope(undefined, scopeValueProvider);
        }

        sanNode.children.forEach(x => createScope(x, childScope));
    }
}


const testSanTemplate = `
    <div>
        <div s-if="false">
            <div class="{{ wtf }}   {{another wtf}}  ">lets make a test {{one}}</div>
            <button value="{= myValue =}" on-click="increase"> incress </button>
        </div>
        <div s-for="a in b"></div>
        <div s-for="a,c in b"></div>
    </div>
`;

const myDoc = parse(testSanTemplate);

function removeParent(node: SanNode) {
    node.parent = undefined;
    node.children.forEach(removeParent);
}

myDoc.roots.forEach(removeParent);

function getTextContent(node: SanNode, source: string) {
    console.log('---------------\n' + source.slice(node.start, node.end) + '\n---------------');
    node.children.forEach(function (node) {
        getTextContent(node, source);
    });
}

myDoc.roots.forEach(function (node) {
    getTextContent(node, testSanTemplate);
});


function findInsertPoint<T extends ts.Node>(context: ts.TransformationContext) {
    return function (rootNode: T) {
        console.log('-.-~');

        const insertedName = 'instance';
        let lastNoneIdentifierNodeKind: ts.SyntaxKind;
        let lastNodeKind: ts.SyntaxKind;

        function visit(node: ts.Node): ts.Node {
            console.log("Visiting " + ts.SyntaxKind[node.kind]);

            if (node.kind == ts.SyntaxKind.BinaryExpression) {
                if ((node as ts.BinaryExpression).operatorToken.kind == ts.SyntaxKind.BarToken) {
                    const filterExpression = node as ts.BinaryExpression;

                    if (filterExpression.right.kind !== ts.SyntaxKind.Identifier) {
                        throw "Syntax Error here";
                    }

                    const propAccess = ts.createBinary(
                        filterExpression.left,
                        filterExpression.operatorToken,
                        ts.createPropertyAccess(
                            ts.createPropertyAccess(
                                ts.createIdentifier(insertedName),
                                'filter'),
                            filterExpression.right as ts.Identifier)
                    );
                    
                    lastNodeKind = node.kind;
                    return propAccess;
                }
            }

            if (node.kind == ts.SyntaxKind.Identifier) {
                console.log((node as ts.Identifier).escapedText);

                if (lastNodeKind !== ts.SyntaxKind.Identifier
                    || lastNoneIdentifierNodeKind !== ts.SyntaxKind.PropertyAccessExpression
                ) {
                    const propAccess = ts.createPropertyAccess(
                        ts.createIdentifier(insertedName),
                        node as ts.Identifier);
                    lastNodeKind = node.kind;
                    return propAccess;
                }
            } else {
                lastNodeKind = node.kind;
                lastNoneIdentifierNodeKind = node.kind;
            }
            return ts.visitEachChild(node, visit, context);
        }
        return ts.visitNode(rootNode, visit);
    }
}

const myProgram = ts.createProgram([], {});
const myChecker = myProgram.getTypeChecker();

const scriptProvideType = ts.createSourceFile('test.ts', 'const wtf = { me: { more: 1 } };', ts.ScriptTarget.ES5, false, ts.ScriptKind.JS);
const scriptNeedTypeInfo = ts.createSourceFile('test.ts',
    `
    wtf.me.more;
    someName;
    someCaculateYes['numberProp'];
    someProp | someFilter;
    someNumber + someCaculateYes.numberProp;
    1 * (someNumber - someCaculateYes['numberProp']);
    (iJust,WantATry);
    a.c.b ? some : more;
    functionCall(some);
    functionCall("some");
`
    , ts.ScriptTarget.ES5, false, ts.ScriptKind.JS);

console.log(scriptProvideType.statements[0]);
console.log('============');
scriptNeedTypeInfo.statements.forEach(stmt => ts.transform(stmt, [findInsertPoint]));
console.log('============');

const transformedFile = ts.transform<ts.SourceFile>(scriptNeedTypeInfo, [findInsertPoint]).transformed[0];
console.log('============');
const printer = ts.createPrinter();
console.log(printer.printFile(scriptNeedTypeInfo));
console.log('============');
console.log(printer.printFile(transformedFile));
