// eslint-disable-next-line no-undef
module.exports = {
  // extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  // parser: '@typescript-eslint/parser',
  // plugins: ['@typescript-eslint'],
  env: {
    es2022: true,
    node: true,
  },
  extends: [
    "eslint:recommended",
    "plugin:eslint-comments/recommended",
    "plugin:n/recommended",
    "plugin:perfectionist/recommended-natural",
    "prettier",
  ],
  overrides: [
    {
      extends: ["plugin:markdown/recommended"],
      files: ["**/*.md"],
      processor: "markdown/markdown",
    },
    {
      extends: [
        "plugin:jsdoc/recommended-typescript-error",
        "plugin:@typescript-eslint/recommended",
      ],
      files: ["**/*.ts"],
      parser: "@typescript-eslint/parser",
      rules: {
        // These off-by-default rules work well for this repo and we like them on.
        "jsdoc/informative-docs": "error",

        // These on-by-default rules don't work well for this repo and we like them off.
        "jsdoc/require-jsdoc": "off",
        "jsdoc/require-param": "off",
        "jsdoc/require-property": "off",
        "jsdoc/require-returns": "off",
      },
    },
    {
      excludedFiles: ["**/*.md/*.ts"],
      extends: [
        "plugin:@typescript-eslint/recommended-requiring-type-checking",
        "plugin:@typescript-eslint/strict",
      ],
      files: ["**/*.ts"],
      parser: "@typescript-eslint/parser",
      parserOptions: {
        project: "./tsconfig.eslint.json",
      },
      rules: {
        // These off-by-default rules work well for this repo and we like them on.
        "deprecation/deprecation": "error",

        // These more-strict-by-default rules don't work well for this repo and we like them less strict.
        "@typescript-eslint/no-unnecessary-condition": [
          "error",
          {
            allowConstantLoopConditions: true,
          },
        ],
      },
    },
    {
      files: "**/*.test.ts",
      rules: {
        // These on-by-default rules aren't useful in test files.
        "@typescript-eslint/no-unsafe-assignment": "off",
        "@typescript-eslint/no-unsafe-call": "off",
      },
    },
    {
      extends: ["plugin:yml/standard", "plugin:yml/prettier"],
      files: ["**/*.{yml,yaml}"],
      parser: "yaml-eslint-parser",
      rules: {
        "yml/file-extension": ["error", { extension: "yml" }],
        "yml/sort-keys": [
          "error",
          {
            order: { type: "asc" },
            pathPattern: "^.*$",
          },
        ],
        "yml/sort-sequence-values": [
          "error",
          {
            order: { type: "asc" },
            pathPattern: "^.*$",
          },
        ],
      },
    },
  ],
  parser: "@typescript-eslint/parser",
  plugins: [
    "@typescript-eslint",
    "deprecation",
    "import",
    "jsdoc",
    "perfectionist",
    "vitest",
  ],
  root: true,
  rules: {
    // These off/less-strict-by-default rules work well for this repo and we like them on.
    "@typescript-eslint/no-unused-vars": ["error", { caughtErrors: "all" }],

    // These on-by-default rules don't work well for this repo and we like them off.
    "import/extensions": "off",
    "n/no-missing-import": "off",
    "n/no-unpublished-import": "off",
    "no-case-declarations": "off",
    "no-constant-condition": "off",
    "no-inner-declarations": "off",

    // Stylistic concerns that don't interfere with Prettier
    "@typescript-eslint/padding-line-between-statements": [
      "error",
      { blankLine: "always", next: "*", prev: "block-like" },
    ],
    "perfectionist/sort-objects": [
      "error",
      {
        order: "asc",
        "partition-by-comment": true,
        type: "natural",
      },
    ],
  },
};
