import { config } from "@netrek/eslint-config/react-internal";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...config,
  {
    rules: {
      "react/prop-types": "off",
    },
  },
];
