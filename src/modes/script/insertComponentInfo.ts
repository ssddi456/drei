import * as path from 'path';
import * as ts from 'typescript';
import { forceReverseSlash } from './preprocess';
import { ComponentInfoProvider } from './findComponents';
import {
    getWrapperRangeSetter,
    createPropertySignature,
    createIdentifier,
    createTypeReferenceNode,
    createTypeQueryNode,
    createTypeAliasDeclaration,
    createTypeLiteralNode,
    createVariableStatement,
    createVariableDeclarationList,
    createVariableDeclaration,
    createPropertyAccess,
    createAsExpression,
    createParen,
    createObjectLiteral,
    createTypeParameterDeclaration,
    createConditionalTypeNode,
    createQualifiedName,
    createInferTypeNode,
    createKeywordTypeNode,
    createImportDeclaration,
    createNamespaceImport,
    createImportClause,
    createLiteral,
    createNamedImports,
    createImportSpecifier,
    vts,
} from './astHelper';

const insertedName = 'instance';
const computedTypeName = 'computedTypeName';

const DataTypeName = 'DataType';
const instanceDataTypeName = 'instanceDataType';

const OtherTypeNmae = 'OtherType';
const instanceOtherTypeName = 'instanceOtherType';

const instaceComputedObjectName = 'instanceComputedObject';



function getMemberKeys(objectType: ts.Type, checker: ts.TypeChecker): string[] {
    return objectType ? Array.from(checker.getPropertiesOfType(objectType).map(s => s.name)) : undefined;
}

export function insectComponentInfo(inforProvider: ComponentInfoProvider, derivedFromFile: string) {

    const checker = inforProvider.checker;
    const dataProperties = inforProvider ? inforProvider.getPropertyType('data') : undefined;
    // or the return type of initData
    const dataKeys = getMemberKeys(dataProperties, checker);

    const initDataMethodType = (inforProvider ? inforProvider.getPropertyType('initData') : undefined) as ts.ObjectType;
    const initDataReturnType = (initDataMethodType && (initDataMethodType.objectFlags & ts.ObjectFlags.Anonymous)) ?
        inforProvider.checker.getSignaturesOfType(initDataMethodType, ts.SignatureKind.Call)[0].getReturnType() : undefined;
    const initDataReturnKeys = getMemberKeys(initDataReturnType, checker);

    // get computed data type should get its return type
    const computedProperties = inforProvider ? inforProvider.getPropertyType('computed') : undefined;
    const computedKeys = getMemberKeys(computedProperties, checker);

    const filterProperties = inforProvider ? inforProvider.getPropertyType('filters') : undefined;
    const filterKeys = getMemberKeys(filterProperties, checker);

    const allMembers = checker ? checker.getPropertiesOfType(inforProvider.defaultExportType) : [];

    console.log('dataKeys', dataKeys);
    console.log('initDataReturnKeys', initDataReturnKeys);
    console.log('computedKeys', computedKeys);
    console.log('filterKeys', filterKeys);


    const allMemberFunctionKeys: string[] = [];
    for (let i = 0; i < allMembers.length; i++) {
        const symbol = allMembers[i];

        if (symbol.flags & ts.SymbolFlags.Method) {
            allMemberFunctionKeys.push(symbol.name);
        }
    }

    return function findInsertPoint<T extends ts.SourceFile>(context: ts.TransformationContext) {
        return function (rootNode: T) {
            console.log('do findInsertPoint', rootNode.fileName);

            const derivedFromFileRelativePath = './' + forceReverseSlash(path.relative(path.dirname(rootNode.fileName), derivedFromFile));
            console.log('derivedFromFileRelativePath', derivedFromFileRelativePath);

            let lastNoneIdentifierNodeKind: ts.SyntaxKind;
            let lastNodeKind: ts.SyntaxKind;

            function visit(node: ts.Node): ts.Node {
                console.log("Visiting " + ts.SyntaxKind[node.kind]);
                if (node.kind == ts.SyntaxKind.SourceFile) {
                    console.log('insert import dependance');

                    const file = node as ts.SourceFile;
                    const statements: Array<ts.Statement> = file.statements as any;

                    if (computedProperties) {
                        const members = computedKeys.map(x => {
                            return vts.createPropertySignature(
                                undefined,
                                vts.createIdentifier(x),
                                undefined,
                                vts.createTypeReferenceNode(
                                    vts.createIdentifier('ReturnType'),
                                    [vts.createTypeQueryNode(
                                        vts.createQualifiedName(
                                            vts.createIdentifier(instaceComputedObjectName),
                                            vts.createIdentifier(x)))]
                                ),
                                undefined)
                        });
                        statements.unshift(
                            vts.createTypeAliasDeclaration(
                                undefined,
                                undefined,
                                vts.createIdentifier(computedTypeName),
                                undefined,
                                vts.createTypeLiteralNode(members)
                            )
                        );

                        statements.unshift(
                            vts.createVariableStatement(
                                undefined,
                                vts.createVariableDeclarationList(
                                    [
                                        vts.createVariableDeclaration(
                                            vts.createIdentifier(instaceComputedObjectName),
                                            undefined,
                                            vts.createPropertyAccess(
                                                vts.createParen(
                                                    vts.createAsExpression(
                                                        vts.createObjectLiteral(),
                                                        vts.createTypeReferenceNode(
                                                            vts.createIdentifier(OtherTypeNmae),
                                                            undefined
                                                        )
                                                    )
                                                ),
                                                vts.createIdentifier('computed'))
                                        )
                                    ],
                                    ts.NodeFlags.Const
                                )
                            )
                        );
                    }



                    statements.unshift(vts.createTypeAliasDeclaration(
                        undefined,
                        undefined,
                        vts.createIdentifier(instanceOtherTypeName),
                        undefined,
                        vts.createTypeReferenceNode(
                            vts.createIdentifier(OtherTypeNmae),
                            [vts.createTypeQueryNode(
                                vts.createIdentifier(insertedName)
                            )]
                        )
                    ));
                    statements.unshift(vts.createTypeAliasDeclaration(
                        undefined,
                        undefined,
                        vts.createIdentifier(instanceDataTypeName),
                        undefined,
                        vts.createTypeReferenceNode(
                            vts.createIdentifier(DataTypeName),
                            [vts.createTypeQueryNode(
                                vts.createIdentifier(insertedName)
                            )]
                        )
                    ));

                    statements.unshift(vts.createTypeAliasDeclaration(
                        undefined,
                        undefined,
                        vts.createIdentifier(DataTypeName),
                        [vts.createTypeParameterDeclaration(
                            vts.createIdentifier('T'),
                            undefined,
                            undefined,
                        )],
                        vts.createConditionalTypeNode(
                            vts.createTypeReferenceNode(
                                vts.createIdentifier('T'),
                                undefined
                            ),
                            vts.createTypeReferenceNode(
                                vts.createQualifiedName(
                                    vts.createIdentifier('San'),
                                    vts.createIdentifier('ComponentConstructor')
                                ),
                                [vts.createInferTypeNode(
                                    vts.createTypeParameterDeclaration(
                                        vts.createIdentifier('U'))),
                                    vts.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword)]
                            ),
                            vts.createTypeReferenceNode(
                                vts.createIdentifier('U'),
                                undefined
                            ),
                            vts.createKeywordTypeNode(ts.SyntaxKind.NeverKeyword)
                        )
                    ));

                    statements.unshift(vts.createTypeAliasDeclaration(
                        undefined,
                        undefined,
                        vts.createIdentifier(OtherTypeNmae),
                        [vts.createTypeParameterDeclaration(
                            vts.createIdentifier('T'),
                            undefined,
                            undefined,
                        )],
                        vts.createConditionalTypeNode(
                            vts.createTypeReferenceNode(
                                vts.createIdentifier('T'),
                                undefined
                            ),
                            vts.createTypeReferenceNode(
                                vts.createQualifiedName(
                                    vts.createIdentifier('San'),
                                    vts.createIdentifier('ComponentConstructor')
                                ),
                                [
                                    vts.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
                                    vts.createInferTypeNode(
                                        vts.createTypeParameterDeclaration(
                                            vts.createIdentifier('U'))),
                                ]
                            ),
                            vts.createTypeReferenceNode(
                                vts.createIdentifier('U'),
                                undefined
                            ),
                            vts.createKeywordTypeNode(ts.SyntaxKind.NeverKeyword)
                        )
                    ));

                    statements.unshift(createImportDeclaration(
                        undefined,
                        undefined,
                        createImportClause(undefined,
                            createNamespaceImport(
                                createIdentifier('San')
                            )),
                        createLiteral('san')
                    ));

                    statements.unshift(
                        createImportDeclaration(
                            undefined,
                            undefined,
                            createImportClause(undefined,
                                createNamedImports(
                                    [createImportSpecifier(
                                        createIdentifier('default'),
                                        createIdentifier(insertedName))
                                    ]
                                )
                            ),
                            createLiteral(derivedFromFileRelativePath)
                        )
                    );
                }

                if (node.kind == ts.SyntaxKind.ImportDeclaration
                    || node.kind == ts.SyntaxKind.TypeAliasDeclaration
                ) {
                    return node;
                }
                if (node.kind == ts.SyntaxKind.BinaryExpression) {
                    if ((node as ts.BinaryExpression).operatorToken.kind == ts.SyntaxKind.BarToken) {
                        const filterExpression = node as ts.BinaryExpression;
                        const right = filterExpression.right;

                        if (right.kind !== ts.SyntaxKind.Identifier
                            && right.kind !== ts.SyntaxKind.CallExpression
                        ) {
                            throw "Syntax Error here";
                        }

                        const propAccess = ts.createBinary(
                            ts.visitEachChild(filterExpression.left, visit, context),
                            filterExpression.operatorToken,

                            // funtion call or identifir so we'll deal it later
                            ts.visitEachChild(right, visit, context)
                        );

                        lastNodeKind = node.kind;
                        return ts.visitEachChild(propAccess, visit, context);
                    }
                }

                if (node.kind == ts.SyntaxKind.Identifier) {
                    console.log((node as ts.Identifier).escapedText);

                    if (lastNodeKind !== ts.SyntaxKind.Identifier
                        || lastNoneIdentifierNodeKind !== ts.SyntaxKind.PropertyAccessExpression
                    ) {
                        const propertyNode = node as ts.Identifier;
                        const propertyName = propertyNode.escapedText as string;

                        console.log('insert instance identifier', propertyNode.escapedText);
                        let insertNode: ts.Expression;
                        const setStartPos = getWrapperRangeSetter({ pos: node.pos, end: node.pos + 1 });

                        if ((dataKeys && dataKeys.includes(propertyName))
                            || (initDataReturnKeys && initDataReturnKeys.includes(propertyName))
                        ) {
                            insertNode = ts.createParen(
                                setStartPos(ts.createAsExpression(
                                    setStartPos(ts.createObjectLiteral(undefined, false)),
                                    setStartPos(ts.createTypeReferenceNode(
                                        setStartPos(ts.createIdentifier(instanceDataTypeName)), undefined))
                                )));
                        } else if (computedKeys && computedKeys.includes(propertyName)) {
                            insertNode = ts.createParen(
                                setStartPos(ts.createAsExpression(
                                    setStartPos(ts.createObjectLiteral(undefined, false)),
                                    setStartPos(ts.createTypeReferenceNode(
                                        setStartPos(ts.createIdentifier(computedTypeName)), undefined))
                                )));
                        } else {
                            // others
                            insertNode = ts.createIdentifier(insertedName);
                        }

                        const propAccess = ts.setTextRange(
                            ts.createPropertyAccess(
                                setStartPos(insertNode),
                                node as ts.Identifier
                            ),
                            node);

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
}
