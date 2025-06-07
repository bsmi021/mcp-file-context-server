/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  preset: 'ts-jest/presets/default-esm', // Correct preset for ESM + TypeScript
  moduleNameMapper: {
    // Handle module aliases (if any), and ensure .js extensions are resolved for ESM
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testEnvironment: 'node',
  // Jest will automatically look for files in `tests` and `__tests__`
  // and files with `.test.ts` or `.spec.ts` extensions.
  // Explicitly defining testMatch can be done if needed but often not necessary.
  // testMatch: [
  //   "**/tests/unit/**/*.test.ts",
  //   "**/__tests__/**/*.test.ts"
  // ],
  // If you have moduleNameMapper issues with node_modules for ESM:
  // transformIgnorePatterns: [
  //   '/node_modules/(?!<module_to_transform>)/' // Adjust <module_to_transform> as needed
  // ],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        // tsconfig: 'tsconfig.json' // Or your specific tsconfig for tests if different
      },
    ],
  },
};
