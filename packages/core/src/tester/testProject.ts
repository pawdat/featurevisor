import * as fs from "fs";

import { TestSegment, TestFeature } from "@featurevisor/types";

import { testSegment } from "./testSegment";
import { testFeature } from "./testFeature";
import { CLI_FORMAT_BOLD, CLI_FORMAT_GREEN, CLI_FORMAT_RED } from "./cliFormat";
import { Dependencies } from "../dependencies";
import { prettyDuration } from "./prettyDuration";
import { printTestResult } from "./printTestResult";

export interface TestProjectOptions {
  keyPattern?: string;
  assertionPattern?: string;
  verbose?: boolean;
  showDatafile?: boolean;
}

export interface TestPatterns {
  keyPattern?: RegExp;
  assertionPattern?: RegExp;
}

export interface ExecutionResult {
  passed: boolean;
  assertionsCount: {
    passed: number;
    failed: number;
  };
}

export async function executeTest(
  testFile: string,
  deps: Dependencies,
  options: TestProjectOptions,
  patterns: TestPatterns,
): Promise<ExecutionResult | undefined> {
  const { datasource, projectConfig, rootDirectoryPath } = deps;

  const testFilePath = datasource.getTestSpecName(testFile);

  const t = await datasource.readTest(testFile);

  const tAsSegment = t as TestSegment;
  const tAsFeature = t as TestFeature;
  const key = tAsSegment.segment || tAsFeature.feature;
  const type = tAsSegment.segment ? "segment" : "feature";

  const executionResult: ExecutionResult = {
    passed: true,
    assertionsCount: {
      passed: 0,
      failed: 0,
    },
  };

  if (!key) {
    console.error(`  => Invalid test: ${JSON.stringify(t)}`);
    executionResult.passed = false;

    return executionResult;
  }

  if (patterns.keyPattern && !patterns.keyPattern.test(key)) {
    return;
  }

  let testResult;
  if (type === "segment") {
    testResult = await testSegment(datasource, tAsSegment, patterns);
  } else {
    testResult = await testFeature(datasource, projectConfig, tAsFeature, options, patterns);
  }

  printTestResult(testResult, testFilePath, rootDirectoryPath);

  if (!testResult.passed) {
    executionResult.passed = false;

    executionResult.assertionsCount.failed = testResult.assertions.filter((a) => !a.passed).length;
    executionResult.assertionsCount.passed +=
      testResult.assertions.length - executionResult.assertionsCount.failed;
  } else {
    executionResult.assertionsCount.passed = testResult.assertions.length;
  }

  return executionResult;
}

export async function testProject(
  deps: Dependencies,
  options: TestProjectOptions = {},
): Promise<boolean> {
  const { projectConfig, datasource } = deps;

  let hasError = false;

  if (!fs.existsSync(projectConfig.testsDirectoryPath)) {
    console.error(`Tests directory does not exist: ${projectConfig.testsDirectoryPath}`);
    hasError = true;

    return hasError;
  }

  const testFiles = await datasource.listTests();

  if (testFiles.length === 0) {
    console.error(`No tests found in: ${projectConfig.testsDirectoryPath}`);
    hasError = true;

    return hasError;
  }

  const startTime = Date.now();

  const patterns: TestPatterns = {
    keyPattern: options.keyPattern ? new RegExp(options.keyPattern) : undefined,
    assertionPattern: options.assertionPattern ? new RegExp(options.assertionPattern) : undefined,
  };

  let passedTestsCount = 0;
  let failedTestsCount = 0;

  let passedAssertionsCount = 0;
  let failedAssertionsCount = 0;

  for (const testFile of testFiles) {
    const executionResult = await executeTest(testFile, deps, options, patterns);

    if (!executionResult) {
      continue;
    }

    if (executionResult.passed) {
      passedTestsCount += 1;
    } else {
      hasError = true;
      failedTestsCount += 1;
    }

    passedAssertionsCount += executionResult.assertionsCount.passed;
    failedAssertionsCount += executionResult.assertionsCount.failed;
  }

  const diffInMs = Date.now() - startTime;

  console.log("\n---\n");

  const testSpecsMessage = `Test specs: ${passedTestsCount} passed, ${failedTestsCount} failed`;
  const testAssertionsMessage = `Assertions: ${passedAssertionsCount} passed, ${failedAssertionsCount} failed`;
  if (hasError) {
    console.log(CLI_FORMAT_RED, testSpecsMessage);
    console.log(CLI_FORMAT_RED, testAssertionsMessage);
  } else {
    console.log(CLI_FORMAT_GREEN, testSpecsMessage);
    console.log(CLI_FORMAT_GREEN, testAssertionsMessage);
  }

  console.log(CLI_FORMAT_BOLD, `Time:       ${prettyDuration(diffInMs)}`);

  return hasError;
}
