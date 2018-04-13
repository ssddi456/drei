import * as ts from 'typescript';
import * as util from 'util';

function findIdentifierNodeAtLocation<T extends ts.Node>(offset: number, result: { lastVisited: ts.Node }) {
    return function (context: ts.TransformationContext) {
        return function (rootNode: T) {
            function visit(node: ts.Node): ts.Node {
                if (node.pos >= 0 && node.end >= 0 && node.pos < node.end) {
                    if (node.pos > offset) {
                        return node;
                    }
                    if (node.end < offset) {
                        return node;
                    }
                    result.lastVisited = node;
                }

                return ts.visitEachChild(node, visit, context);
            }
            return ts.visitNode(rootNode, visit);
        }
    }
}


export function findIdentifierNodeAtLocationInAst(sourceFile: ts.SourceFile, offset: number) {
    const lastVisited = { lastVisited: undefined as ts.Node };
    ts.transform<ts.SourceFile>(sourceFile, [findIdentifierNodeAtLocation(offset, lastVisited)]);
    return lastVisited.lastVisited;
}


export function nodeTypeLogger(node: ts.Node) {
    ts.transform(node, [nodeTypeLoggerWorker]);
}

function nodeTypeLoggerWorker<T extends ts.Node>(context: ts.TransformationContext) {
    const VisitedNode: ts.Node[] = [];

    return function (rootNode: T) {
        VisitedNode.push(rootNode);
        function visit(node: ts.Node): ts.Node {
            console.log("Visiting " + ts.SyntaxKind[node.kind]);

            if (node.kind == ts.SyntaxKind.Identifier) {
                console.log((node as ts.Identifier).escapedText);
            }
            if (VisitedNode.indexOf(rootNode) != -1) {
                return undefined;
            }

            VisitedNode.push(rootNode);
            const ret = ts.visitEachChild(node, visit, context);
            return ret.parent = undefined;
        }

        return ts.visitNode(rootNode, visit);
    }
}

export function nodeStringify(node: ts.Node) {
    return;
    console.log('------------------');
    function worker<T extends ts.Node>(context: ts.TransformationContext) {
        return function (rootNode: T) {
            function visit(node: ts.Node): ts.Node {
                return ts.visitEachChild(node, visit, context);
            }
            return ts.visitNode(rootNode, visit);
        }
    }
    // copy ast
    const ret = ts.transform(node, [worker]).transformed[0];
    function removeParent(node: {}) {
        if (node.hasOwnProperty('parent')) {
            node.parent = undefined;
        }
        if (node.hasOwnProperty('symbol')) {
            node.symbol = undefined;
        }

        for (var k in node) {
            if (node.hasOwnProperty(k) && typeof node[k] === 'object') {
                removeParent(node[k]);
            }
        }
    }
    removeParent(ret);
    console.log('inspected', JSON.stringify(ret, null, 2));
    console.log('------------------');
}

ts.nodeStringify = nodeStringify;

/** Create a function that calls setTextRange on synthetic wrapper nodes that need a valid range */
export function getWrapperRangeSetter(wrapped: ts.TextRange): <T extends ts.TextRange>(wrapperNode: T) => T {
    return <T extends ts.TextRange>(wrapperNode: T) => ts.setTextRange(wrapperNode, wrapped);
}
export const setZeroPos = getWrapperRangeSetter({ pos: 0, end: 0 });
export function setZeroPosed<T extends ts.Node>(createNode: (...args: any[]) => T) {
    return (...args: any[]) => {
        return setZeroPos(createNode.call(null, ...args));
    };
}
