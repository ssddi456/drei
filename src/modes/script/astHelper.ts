import * as ts from 'typescript';

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
export function wrapSetPos<T extends ts.Node> ( setpos: (wrapNode: T) => T ){
    return function <T extends ts.Node>(createNode: (...args: any[]) => T ) {
        return (...args: any[]) => {
            return setpos(createNode.call(null, ...args));
        };
    }
}
export const setZeroPosed =  wrapSetPos(setZeroPos);

export const createAsExpression = setZeroPosed(ts.createAsExpression) as typeof ts.createAsExpression;
export const createBinary = setZeroPosed(ts.createBinary) as typeof ts.createBinary;
export const createConditionalTypeNode = setZeroPosed(ts.createConditionalTypeNode) as typeof ts.createConditionalTypeNode;
export const createIdentifier = setZeroPosed(ts.createIdentifier) as typeof ts.createIdentifier;
export const createImportClause = setZeroPosed(ts.createImportClause) as typeof ts.createImportClause;
export const createImportDeclaration = setZeroPosed(ts.createImportDeclaration) as typeof ts.createImportDeclaration;
export const createImportSpecifier = setZeroPosed(ts.createImportSpecifier) as typeof ts.createImportSpecifier;
export const createInferTypeNode = setZeroPosed(ts.createInferTypeNode) as typeof ts.createInferTypeNode;
export const createKeywordTypeNode = setZeroPosed(ts.createKeywordTypeNode) as typeof ts.createKeywordTypeNode;
export const createLanguageServiceSourceFile = setZeroPosed(ts.createLanguageServiceSourceFile) as typeof ts.createLanguageServiceSourceFile;
export const createLiteral = setZeroPosed(ts.createLiteral) as typeof ts.createLiteral;
export const createNamedImports = setZeroPosed(ts.createNamedImports) as typeof ts.createNamedImports;
export const createNamespaceImport = setZeroPosed(ts.createNamespaceImport) as typeof ts.createNamespaceImport;
export const createObjectLiteral = setZeroPosed(ts.createObjectLiteral) as typeof ts.createObjectLiteral;
export const createParen = setZeroPosed(ts.createParen) as typeof ts.createParen;
export const createPropertyAccess = setZeroPosed(ts.createPropertyAccess) as typeof ts.createPropertyAccess;
export const createPropertySignature = setZeroPosed(ts.createPropertySignature) as typeof ts.createPropertySignature;
export const createQualifiedName = setZeroPosed(ts.createQualifiedName) as typeof ts.createQualifiedName;
export const createTypeAliasDeclaration = setZeroPosed(ts.createTypeAliasDeclaration) as typeof ts.createTypeAliasDeclaration;
export const createTypeLiteralNode = setZeroPosed(ts.createTypeLiteralNode) as typeof ts.createTypeLiteralNode;
export const createTypeParameterDeclaration = setZeroPosed(ts.createTypeParameterDeclaration) as typeof ts.createTypeParameterDeclaration;
export const createTypeQueryNode = setZeroPosed(ts.createTypeQueryNode) as typeof ts.createTypeQueryNode;
export const createTypeReferenceNode = setZeroPosed(ts.createTypeReferenceNode) as typeof ts.createTypeReferenceNode;
export const createVariableDeclaration = setZeroPosed(ts.createVariableDeclaration) as typeof ts.createVariableDeclaration;
export const createVariableDeclarationList = setZeroPosed(ts.createVariableDeclarationList) as typeof ts.createVariableDeclarationList;
export const createVariableStatement = setZeroPosed(ts.createVariableStatement) as typeof ts.createVariableStatement;

export function createVts (pos: ts.TextRange){
    const setPosed = wrapSetPos(getWrapperRangeSetter(pos));
    return {
        createAsExpression: setPosed(ts.createAsExpression) as typeof ts.createAsExpression,
        createBinary: setPosed(ts.createBinary) as typeof ts.createBinary,
        createConditionalTypeNode: setPosed(ts.createConditionalTypeNode) as typeof ts.createConditionalTypeNode,
        createIdentifier: setPosed(ts.createIdentifier) as typeof ts.createIdentifier,
        createImportClause: setPosed(ts.createImportClause) as typeof ts.createImportClause,
        createImportDeclaration: setPosed(ts.createImportDeclaration) as typeof ts.createImportDeclaration,
        createImportSpecifier: setPosed(ts.createImportSpecifier) as typeof ts.createImportSpecifier,
        createInferTypeNode: setPosed(ts.createInferTypeNode) as typeof ts.createInferTypeNode,
        createKeywordTypeNode: setPosed(ts.createKeywordTypeNode) as typeof ts.createKeywordTypeNode,
        createLanguageServiceSourceFile: setPosed(ts.createLanguageServiceSourceFile) as typeof ts.createLanguageServiceSourceFile,
        createLiteral: setPosed(ts.createLiteral) as typeof ts.createLiteral,
        createNamedImports: setPosed(ts.createNamedImports) as typeof ts.createNamedImports,
        createNamespaceImport: setPosed(ts.createNamespaceImport) as typeof ts.createNamespaceImport,
        createObjectLiteral: setPosed(ts.createObjectLiteral) as typeof ts.createObjectLiteral,
        createParen: setPosed(ts.createParen) as typeof ts.createParen,
        createPropertyAccess: setPosed(ts.createPropertyAccess) as typeof ts.createPropertyAccess,
        createPropertySignature: setPosed(ts.createPropertySignature) as typeof ts.createPropertySignature,
        createQualifiedName: setPosed(ts.createQualifiedName) as typeof ts.createQualifiedName,
        createTypeAliasDeclaration: setPosed(ts.createTypeAliasDeclaration) as typeof ts.createTypeAliasDeclaration,
        createTypeLiteralNode: setPosed(ts.createTypeLiteralNode) as typeof ts.createTypeLiteralNode,
        createTypeParameterDeclaration: setPosed(ts.createTypeParameterDeclaration) as typeof ts.createTypeParameterDeclaration,
        createTypeQueryNode: setPosed(ts.createTypeQueryNode) as typeof ts.createTypeQueryNode,
        createTypeReferenceNode: setPosed(ts.createTypeReferenceNode) as typeof ts.createTypeReferenceNode,
        createVariableDeclaration: setPosed(ts.createVariableDeclaration) as typeof ts.createVariableDeclaration,
        createVariableDeclarationList: setPosed(ts.createVariableDeclarationList) as typeof ts.createVariableDeclarationList,
        createVariableStatement: setPosed(ts.createVariableStatement) as typeof ts.createVariableStatement,
    };
}; 

export const vts = createVts({ pos: 0, end: 1 });
