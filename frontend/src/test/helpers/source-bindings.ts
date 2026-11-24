import ts from "typescript";

/** Resolve local bindings without loading the project's dependency graph. */
export function sourceBindings(file: string, text: string) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const options = { noLib: true, noResolve: true, types: [] };
  const host = ts.createCompilerHost(options, true);
  host.getSourceFile = (name) => (name === file ? source : undefined);
  const checker = ts.createProgram([file], options, host).getTypeChecker();

  function binding(
    node: ts.Expression,
    seen = new Set<ts.Node>(),
  ): { from?: string; names: string[] } {
    if (seen.has(node)) return { names: [] };
    seen.add(node);
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isNonNullExpression(node)
    )
      return binding(node.expression, seen);
    if (
      ts.isPropertyAccessExpression(node) ||
      ts.isElementAccessExpression(node)
    ) {
      const key = ts.isPropertyAccessExpression(node)
        ? node.name.text
        : ts.isStringLiteralLike(node.argumentExpression)
          ? node.argumentExpression.text
          : undefined;
      if (key === undefined) return { names: [] };
      const base = binding(node.expression, seen);
      return { from: base.from, names: [...base.names, key] };
    }
    if (!ts.isIdentifier(node)) return { names: [] };
    const declaration = checker.getSymbolAtLocation(node)?.declarations?.[0];
    if (!declaration) return { names: [node.text] };
    if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
      return binding(declaration.initializer, seen);
    }
    if (
      ts.isBindingElement(declaration) &&
      ts.isObjectBindingPattern(declaration.parent)
    ) {
      const owner = declaration.parent.parent;
      const key = declaration.propertyName ?? declaration.name;
      if (
        ts.isVariableDeclaration(owner) &&
        owner.initializer &&
        (ts.isIdentifier(key) || ts.isStringLiteralLike(key))
      ) {
        const base = binding(owner.initializer, seen);
        return { from: base.from, names: [...base.names, key.text] };
      }
    }
    if (
      ts.isNamespaceImport(declaration) ||
      ts.isImportSpecifier(declaration)
    ) {
      const imported = ts.isNamespaceImport(declaration)
        ? declaration.parent.parent
        : declaration.parent.parent.parent;
      if (
        ts.isImportDeclaration(imported) &&
        ts.isStringLiteral(imported.moduleSpecifier)
      ) {
        return {
          from: imported.moduleSpecifier.text,
          names: ts.isNamespaceImport(declaration)
            ? []
            : [(declaration.propertyName ?? declaration.name).text],
        };
      }
    }
    return { names: [] };
  }

  return {
    source,
    binding,
    declaration: (node: ts.Identifier) =>
      (ts.isShorthandPropertyAssignment(node.parent)
        ? checker.getShorthandAssignmentValueSymbol(node.parent)
        : checker.getSymbolAtLocation(node)
      )?.valueDeclaration,
  };
}
