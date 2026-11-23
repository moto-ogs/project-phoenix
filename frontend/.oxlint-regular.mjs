import config from "./.oxlintrc.json" with { type: "json" };

const numericRule = "bff-boundary/no-numeric-identifier";

export default {
  ...config,
  rules: { ...config.rules, [numericRule]: "off" },
};

export const numericOnly = {
  ...config,
  plugins: [],
  jsPlugins: ["./scripts/oxlint-plugin-bff-boundary.mjs"],
  categories: { correctness: "off" },
  rules: { [numericRule]: config.rules[numericRule] },
};
