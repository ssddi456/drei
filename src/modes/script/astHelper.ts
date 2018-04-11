import * as ts from 'typescript';

function findIdentifierNodeAtLocation<T extends ts.Node>(offset: number, result: { lastVisited: ts.Node }) {
    return function (context: ts.TransformationContext) {
        return function (rootNode: T) {
            function visit(node: ts.Node): ts.Node {
                if (node.pos >= 0 && node.end >= 0 && node.pos < node.end) {

                    // console.log(ts.SyntaxKind[node.kind], node.pos, node.end, !!node.parent);

                    if (node.pos > offset) {
                        return node;
                    }
                    if (node.end < offset) {
                        return node;
                    }

                    // console.log('replace lastVisited', node.getText());

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
