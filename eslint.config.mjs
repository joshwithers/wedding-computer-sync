import tseslint from 'typescript-eslint'
import obsidianmd from 'eslint-plugin-obsidianmd'

export default tseslint.config(
  ...tseslint.configs.recommendedTypeChecked,
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      // Brand names and quoted UI labels keep their capitals; the rule
      // polices everything else.
      'obsidianmd/ui/sentence-case': [
        'error',
        { ignoreWords: ['Wedding', 'Computer', 'Obsidian', 'CalDAV', 'CardDAV', 'iCloud', 'Pro', 'Device', 'Generate'] },
      ],
    },
  },
  { ignores: ['main.js', 'esbuild.config.mjs', 'eslint.config.mjs'] }
)
