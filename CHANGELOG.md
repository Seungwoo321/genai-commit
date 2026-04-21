# Changelog

## [1.11.0](https://github.com/Seungwoo321/genai-commit/compare/v1.11.0-beta.0...v1.11.0) (2026-04-21)

## [1.11.0-beta.0](https://github.com/Seungwoo321/genai-commit/compare/v1.10.0...v1.11.0-beta.0) (2026-04-21)

### Features

* **cli:** add provider alias support and improve command handling ([2cc6a11](https://github.com/Seungwoo321/genai-commit/commit/2cc6a11fe07aaf3533a4dca5e23832c1d3a3cb63))
* **config:** add Codex provider configuration ([ac206e6](https://github.com/Seungwoo321/genai-commit/commit/ac206e608f94c2f792c65c359e4f4ac4650b5291))
* **provider:** add Codex CLI provider support ([35e088f](https://github.com/Seungwoo321/genai-commit/commit/35e088f39aafda651e6959e438e627f3c2433cbc))

### Refactoring

* **core:** update exports for new provider support ([6d69fb7](https://github.com/Seungwoo321/genai-commit/commit/6d69fb738eab4b3fb990ab6933f01bc37ca9c521))
* **ui:** improve interactive menu text clarity ([3fb5d18](https://github.com/Seungwoo321/genai-commit/commit/3fb5d188b5d6bbe13d2b3463f2a53f01800acaef))

### Documentation

* **prompts:** update commit generation rules and examples ([3abc2a3](https://github.com/Seungwoo321/genai-commit/commit/3abc2a3d582bcf15fc0ba044297a5de45615a01a))
* **readme:** add Codex CLI support and improve documentation ([807a153](https://github.com/Seungwoo321/genai-commit/commit/807a153116a4cdd9a51a21888c88e6a6ac172eb4))

## [1.10.0](https://github.com/Seungwoo321/genai-commit/compare/v1.10.0-beta.0...v1.10.0) (2026-04-21)

## [1.10.0-beta.0](https://github.com/Seungwoo321/genai-commit/compare/v1.9.1...v1.10.0-beta.0) (2026-04-21)

### Features

* **git:** improve staging error handling and subdirectory support ([796a6ab](https://github.com/Seungwoo321/genai-commit/commit/796a6ab40bce0c2e2aa4c1ebc4f2fe21812ab345))

### Bug Fixes

* **git:** add --no-index flag to check-ignore command ([df13815](https://github.com/Seungwoo321/genai-commit/commit/df13815dee0801251d280bb674a0c462c72a7e0e))

## [1.9.1](https://github.com/Seungwoo321/genai-commit/compare/v1.9.1-beta.0...v1.9.1) (2026-03-27)

## [1.9.1-beta.0](https://github.com/Seungwoo321/genai-commit/compare/v1.9.0...v1.9.1-beta.0) (2026-03-27)

### Bug Fixes

* **git:** handle fetch failure gracefully in remote status check ([6120a0a](https://github.com/Seungwoo321/genai-commit/commit/6120a0a6e752a630df1aaf23ee724e370899874f))

## [1.9.0](https://github.com/Seungwoo321/genai-commit/compare/v1.9.0-beta.0...v1.9.0) (2026-03-27)

## [1.9.0-beta.0](https://github.com/Seungwoo321/genai-commit/compare/v1.8.0...v1.9.0-beta.0) (2026-03-27)

### Features

* **validation:** support directory-level file matching ([c137076](https://github.com/Seungwoo321/genai-commit/commit/c137076a02dfe659eb3c02957e3112b184719647))

### Bug Fixes

* **git:** handle staging reset for repos without commits ([8033fb7](https://github.com/Seungwoo321/genai-commit/commit/8033fb70bd26add6fafa6d9f0985e4ec6599befc))

## [1.8.0](https://github.com/Seungwoo321/genai-commit/compare/v1.8.0-beta.0...v1.8.0) (2026-03-27)

## [1.8.0-beta.0](https://github.com/Seungwoo321/genai-commit/compare/v1.7.1...v1.8.0-beta.0) (2026-03-27)

### Features

* **git:** add commit execution module ([69fd2b3](https://github.com/Seungwoo321/genai-commit/commit/69fd2b303b592c0c368dad06d1b12bbfedd2bb04))

### Refactoring

* **git:** improve gitignore handling in stage logic ([f17cba8](https://github.com/Seungwoo321/genai-commit/commit/f17cba846b4d9071fbb15effed476439e3d97388))

## [1.7.1](https://github.com/Seungwoo321/genai-commit/compare/v1.7.1-beta.0...v1.7.1) (2026-03-27)

## [1.7.1-beta.0](https://github.com/Seungwoo321/genai-commit/compare/v1.7.0...v1.7.1-beta.0) (2026-03-27)

### Bug Fixes

* **git:** handle deleted files properly in staging ([95ebae1](https://github.com/Seungwoo321/genai-commit/commit/95ebae1374b8ade4e8ff4ef985101ee0f0a70fcc))

## [1.7.0](https://github.com/Seungwoo321/genai-commit/compare/v1.7.0-beta.0...v1.7.0) (2026-03-27)

## [1.7.0-beta.0](https://github.com/Seungwoo321/genai-commit/compare/v1.6.0...v1.7.0-beta.0) (2026-03-27)

### Features

* **tree:** add progressive depth reduction for large trees ([f702554](https://github.com/Seungwoo321/genai-commit/commit/f7025548ffc737d0427724bf13fa074b22145414))

## [1.6.0](https://github.com/Seungwoo321/genai-commit/compare/v1.6.0-beta.0...v1.6.0) (2026-03-27)

## [1.6.0-beta.0](https://github.com/Seungwoo321/genai-commit/compare/v1.5.1...v1.6.0-beta.0) (2026-03-27)

### Features

* **validation:** add missing file detection ([dca0f06](https://github.com/Seungwoo321/genai-commit/commit/dca0f0689e5b941c97b4c4fd600db51888347d47))

### Bug Fixes

* **git:** improve error logging for file staging ([6a94046](https://github.com/Seungwoo321/genai-commit/commit/6a9404634760a06bdb0d7b3d9f7b071cf0834fcf))

## [1.5.1](https://github.com/Seungwoo321/genai-commit/compare/v1.5.0...v1.5.1) (2026-03-27)

### Refactoring

* **git:** stage files individually for better error handling ([248afdb](https://github.com/Seungwoo321/genai-commit/commit/248afdb258b62697b78ab85a022b0f379aae2ad0))

## [1.5.0](https://github.com/Seungwoo321/genai-commit/compare/v1.4.0...v1.5.0) (2026-03-27)

### Features

* **git:** support renamed file tracking ([905ee8a](https://github.com/Seungwoo321/genai-commit/commit/905ee8adcaec4a555438918f7cb688d3c7283fcf))

### Refactoring

* **git:** simplify file staging logic ([b25c1e3](https://github.com/Seungwoo321/genai-commit/commit/b25c1e3d423d2e75dae2d2697a5bfad29872a46b))

### Documentation

* **prompts:** clarify rename file handling rules ([3a6f69e](https://github.com/Seungwoo321/genai-commit/commit/3a6f69e166a7385e4832e1d5990882ff9e3b555b))

## [1.4.0](https://github.com/Seungwoo321/genai-commit/compare/v1.4.0-beta.0...v1.4.0) (2026-03-08)

## [1.4.0-beta.0](https://github.com/Seungwoo321/genai-commit/compare/v1.3.1...v1.4.0-beta.0) (2026-03-08)

### Features

* **git:** support diff operations for repos without commits ([42d7c03](https://github.com/Seungwoo321/genai-commit/commit/42d7c03ec1f1aec0b19830489a9dd996240a45f2))

## [1.3.1](https://github.com/Seungwoo321/genai-commit/compare/v1.3.1-beta.0...v1.3.1) (2026-03-05)

## [1.3.1-beta.0](https://github.com/Seungwoo321/genai-commit/compare/v1.3.0...v1.3.1-beta.0) (2026-03-05)

### Bug Fixes

* **git:** handle branch detection in empty repositories ([7197129](https://github.com/Seungwoo321/genai-commit/commit/719712979c77825b8d4cc71d07ea8101146ba489))

### Refactoring

* remove unused imports ([6e05569](https://github.com/Seungwoo321/genai-commit/commit/6e055699330e6c500e2319ff0e2500ea95d29a5e))

## [1.3.0](https://github.com/Seungwoo321/genai-commit/compare/v1.3.0-beta.0...v1.3.0) (2026-03-03)

## [1.3.0-beta.0](https://github.com/Seungwoo321/genai-commit/compare/v1.2.2-beta.0...v1.3.0-beta.0) (2026-03-03)

### Features

* **cursor:** add trust flag to CLI command ([e5fb702](https://github.com/Seungwoo321/genai-commit/commit/e5fb70222ac5a6a336776ee0fb44340cb8f430dd))
* **git:** add automatic staging before diff analysis ([58e3142](https://github.com/Seungwoo321/genai-commit/commit/58e31427ccbf55246409f56161ef7febcf0b56dc))
* **git:** add staging reset before commit execution ([598f8db](https://github.com/Seungwoo321/genai-commit/commit/598f8dbbcca70a58b93e4db618dbbfbd133509e6))

## [1.2.2-beta.0](https://github.com/Seungwoo321/genai-commit/compare/v1.2.1...v1.2.2-beta.0) (2026-01-17)

## [1.2.1](https://github.com/Seungwoo321/genai-commit/compare/v1.2.0...v1.2.1) (2026-01-17)

## [1.2.0](https://github.com/Seungwoo321/genai-commit/compare/v1.2.0-beta.0...v1.2.0) (2026-01-17)

## [1.2.0-beta.0](https://github.com/Seungwoo321/genai-commit/compare/v1.1.0-beta.2...v1.2.0-beta.0) (2026-01-17)

## [1.1.0-beta.2](https://github.com/Seungwoo321/genai-commit/compare/v1.1.0...v1.1.0-beta.2) (2026-01-17)

### Features

* add remote tracking branch status check ([dc55d81](https://github.com/Seungwoo321/genai-commit/commit/dc55d815b2181441330c6862e4f4c36279bbb079))

### Documentation

* update CLI names and usage examples ([61cc3dd](https://github.com/Seungwoo321/genai-commit/commit/61cc3dd04c4207521701d868114bf7bf0d9c1d3e))

## [1.1.0](https://github.com/Seungwoo321/genai-commit/compare/v1.1.0-beta.0...v1.1.0) (2026-01-17)

## [1.1.0-beta.0](https://github.com/Seungwoo321/genai-commit/compare/v1.0.2...v1.1.0-beta.0) (2026-01-17)

### Features

* add error reporting link on commit generation failure ([aaeab3f](https://github.com/Seungwoo321/genai-commit/commit/aaeab3f6312986fdee446d66e1b811f5329d5b28))
* add interactive mode support for CLI commands ([e081ae7](https://github.com/Seungwoo321/genai-commit/commit/e081ae74733f5ca74766801dcaa19f7fdc139554))
* add models command to list supported models ([ab05bbb](https://github.com/Seungwoo321/genai-commit/commit/ab05bbbb5e9e6654f09ff46a212ce789c07d32ab))
* update default Cursor model and add model lists ([5ca52bc](https://github.com/Seungwoo321/genai-commit/commit/5ca52bc8f9fcabb537be0bb13757defb10fb8636))

### Bug Fixes

* correct Cursor CLI command invocation ([9f92b44](https://github.com/Seungwoo321/genai-commit/commit/9f92b44f510d0b6d808a87aef02c92bcbaba6fa9))

### Documentation

* update CLI examples and add models command ([7e27e6b](https://github.com/Seungwoo321/genai-commit/commit/7e27e6b5bd09c45c161e8f9443a1d60516189cd9))

## [1.0.2](https://github.com/Seungwoo321/genai-commit/compare/v1.0.1...v1.0.2) (2026-01-17)

### Bug Fixes

* support flexible Jira key patterns and extract last key from path ([a27b80b](https://github.com/Seungwoo321/genai-commit/commit/a27b80b5d9a2421f3bf2c4118f0595dd1781f008))

## [1.0.1](https://github.com/Seungwoo321/genai-commit/compare/v1.0.1-beta.2...v1.0.1) (2026-01-14)

## [1.0.1-beta.2](https://github.com/Seungwoo321/genai-commit/compare/v1.0.1-beta.1...v1.0.1-beta.2) (2026-01-14)

## [1.0.1-beta.1](https://github.com/Seungwoo321/genai-commit/compare/v1.0.1-beta.0...v1.0.1-beta.1) (2026-01-14)

### Bug Fixes

* upgrade release-it and add conventional-changelog plugin ([89f1cec](https://github.com/Seungwoo321/genai-commit/commit/89f1cec8f1f03ffd4bb9f32a9ec8c403cbf0f047))
