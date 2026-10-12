import tseslint from 'typescript-eslint';
export default tseslint.config({ignores:['dist-tool/**']}, ...tseslint.configs.recommended, {files:['**/*.ts'],rules:{'@typescript-eslint/no-explicit-any':'off','curly':['error','all']}});
