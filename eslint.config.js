import globals from "globals";
import pluginJs from "@eslint/js";

export default [
  {
    languageOptions: {
      globals: globals.nodeBuiltin,
    },
  },
  pluginJs.configs.recommended,
];
