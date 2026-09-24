const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

require("dotenv").config();

const command = process.argv[2];
const commandArguments = process.argv.slice(3);
const noGit = commandArguments.includes("--nogit");
const filteredCommandArguments = commandArguments.filter(
  (argument) => argument !== "--nogit",
);

const projectRoot = path.resolve(__dirname);
const baseFolder = path.resolve(projectRoot, process.env.LOCAL_PATH || "./src");

const gitRemote = process.env.GIT_REMOTE || "origin";
const configuredGitBranch = process.env.GIT_BRANCH || "";
const requireCleanDeploy = parseBoolean(
  process.env.GIT_REQUIRE_CLEAN_DEPLOY,
  true,
);
const requireRemoteSync = parseBoolean(
  process.env.GIT_REQUIRE_REMOTE_SYNC,
  true,
);
const allowProductionBranches = parseList(
  process.env.GIT_PRODUCTION_BRANCHES || "main,master",
);

function parseBoolean(value, defaultValue) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  return String(value).trim().toLowerCase() === "true";
}

function parseList(value) {
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function quoteCommandArgument(value) {
  const text = String(value);

  if (/^[a-zA-Z0-9_./:@=-]+$/.test(text)) {
    return text;
  }

  return `"${text.replace(/"/g, '\\"')}"`;
}

function formatCommand(executable, args) {
  return [executable]
    .concat(args || [])
    .map(quoteCommandArgument)
    .join(" ");
}

function runCommand(executable, args, options) {
  const settings = options || {};
  const displayCommand = formatCommand(executable, args);

  if (!settings.silent) {
    console.log(`> ${displayCommand}`);
  }

  const result = spawnSync(executable, args || [], {
    cwd: settings.cwd || projectRoot,
    encoding: "utf8",
    stdio: settings.capture ? "pipe" : "inherit",
    shell: false,
    env: process.env,
  });

  if (result.error) {
    throw new Error(
      `Unable to execute "${executable}": ${result.error.message}`,
    );
  }

  if (result.status !== 0 && !settings.allowFailure) {
    const stderr = result.stderr ? result.stderr.trim() : "";
    const stdout = result.stdout ? result.stdout.trim() : "";
    const details = stderr || stdout;

    throw new Error(
      details
        ? `Command failed: ${displayCommand}\n${details}`
        : `Command failed with exit code ${result.status}: ${displayCommand}`,
    );
  }

  return result;
}

function captureCommand(executable, args, options) {
  const settings = Object.assign({}, options || {}, {
    capture: true,
    silent: true,
  });

  const result = runCommand(executable, args, settings);
  return result.stdout ? result.stdout.trim() : "";
}

function commandExists(executable, versionArguments) {
  const result = spawnSync(executable, versionArguments || ["--version"], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: "pipe",
    shell: false,
    env: process.env,
  });

  return !result.error && result.status === 0;
}

function ensureRequiredTools(requireGit = true) {
  if (requireGit && !commandExists("git", ["--version"])) {
    throw new Error("Git is not installed or is not available on PATH.");
  }

  if (!commandExists("pac", [])) {
    throw new Error(
      "Power Platform CLI is not installed or is not available on PATH.",
    );
  }
}

function getSiteFolderPath(parentDir) {
  if (!fs.existsSync(parentDir)) {
    return parentDir;
  }

  if (
    fs.existsSync(path.join(parentDir, "website.yml")) ||
    fs.existsSync(path.join(parentDir, "manifest.yml"))
  ) {
    return parentDir;
  }

  const items = fs.readdirSync(parentDir, { withFileTypes: true });

  for (const item of items) {
    if (!item.isDirectory()) continue;

    const subPath = path.join(parentDir, item.name);
    if (
      fs.existsSync(path.join(subPath, "website.yml")) ||
      fs.existsSync(path.join(subPath, "manifest.yml"))
    ) {
      return subPath;
    }
  }

  return parentDir;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ask(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function confirmProductionPush() {
  console.log("");
  console.log("========================================");
  console.log("PRODUCTION DEPLOYMENT DETECTED");
  console.log("========================================");
  console.log("");

  const answer1 = await ask(
    'Are you sure you want to deploy to PRODUCTION? Type "yes": ',
  );
  if (answer1.toLowerCase() !== "yes") {
    throw new Error("Production deployment cancelled.");
  }

  await sleep(3000);
  const answer2 = await ask('Are you REALLY sure? Type "yes": ');
  if (answer2.toLowerCase() !== "yes") {
    throw new Error("Production deployment cancelled.");
  }

  await sleep(3000);
  const answer3 = await ask(
    'Last chance. This will overwrite the live site. Type "yes": ',
  );
  if (answer3.toLowerCase() !== "yes") {
    throw new Error("Production deployment cancelled.");
  }

  console.log("");
  console.log("Production deployment confirmed.");
  console.log("");
}

function getEnvironmentConfig(target) {
  let config;

  switch (target) {
    case "dev":
      config = {
        key: "dev",
        name: "Development",
        envId: process.env.DEVELOPMENT_ENVIRONMENT_ID,
        siteId: process.env.DEVELOPMENT_WEBSITE_ID,
      };
      break;
    case "prod":
      config = {
        key: "prod",
        name: "Production",
        envId: process.env.PRODUCTION_ENVIRONMENT_ID,
        siteId: process.env.PRODUCTION_WEBSITE_ID,
      };
      break;
    default:
      throw new Error(`Unknown target environment: ${target}`);
  }

  if (!config.envId) {
    throw new Error(`${config.name} environment ID is missing from .env.`);
  }
  if (!config.siteId) {
    throw new Error(`${config.name} website ID is missing from .env.`);
  }

  return config;
}

function ensureGitRepository() {
  const insideWorkTree = captureCommand(
    "git",
    ["rev-parse", "--is-inside-work-tree"],
    { allowFailure: true },
  );

  if (insideWorkTree !== "true") {
    throw new Error(
      "The project is not inside a Git repository. Run npm run git:init first.",
    );
  }
}

function getCurrentBranch() {
  const branch = captureCommand("git", ["branch", "--show-current"]);
  if (!branch) {
    throw new Error(
      "Git is in detached HEAD state. Check out a named branch before continuing.",
    );
  }
  return branch;
}

function getTargetGitBranch() {
  return configuredGitBranch || getCurrentBranch();
}

function getWorkingTreeStatus() {
  return captureCommand("git", [
    "status",
    "--porcelain",
    "--untracked-files=all",
  ]);
}

function hasWorkingTreeChanges() {
  return getWorkingTreeStatus().length > 0;
}

function ensureCleanWorkingTree() {
  const status = getWorkingTreeStatus();
  if (!status) return;

  console.log("");
  console.log("Uncommitted Git changes:");
  console.log(status);
  console.log("");

  throw new Error(
    'Deployment blocked because the working tree is not clean. Commit with npm run save -- "Your message" before deploying.',
  );
}

function remoteExists() {
  const remotes = captureCommand("git", ["remote"]);
  return remotes
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .includes(gitRemote);
}

function getRemoteUrl() {
  if (!remoteExists()) return "";
  return captureCommand("git", ["remote", "get-url", gitRemote]);
}

function remoteBranchExists(branch) {
  if (!remoteExists()) return false;

  const result = runCommand(
    "git",
    ["show-ref", "--verify", "--quiet", `refs/remotes/${gitRemote}/${branch}`],
    { capture: true, silent: true, allowFailure: true },
  );
  return result.status === 0;
}

function getAheadBehind(branch) {
  const output = captureCommand("git", [
    "rev-list",
    "--left-right",
    "--count",
    `${gitRemote}/${branch}...HEAD`,
  ]);
  const values = output.split(/\s+/);

  if (values.length !== 2) {
    throw new Error(
      `Unable to determine Git divergence from ${gitRemote}/${branch}.`,
    );
  }

  return { behind: Number(values[0]), ahead: Number(values[1]) };
}

function fetchGitRemote() {
  if (!remoteExists()) {
    throw new Error(
      `Git remote "${gitRemote}" does not exist. Add the enterprise repository as a remote first.`,
    );
  }

  console.log(`Fetching ${gitRemote}...`);
  runCommand("git", ["fetch", "--prune", gitRemote]);
}

function ensureExpectedBranch() {
  const currentBranch = getCurrentBranch();
  const expectedBranch = getTargetGitBranch();

  if (currentBranch !== expectedBranch) {
    throw new Error(
      `Current branch is "${currentBranch}", but GIT_BRANCH is configured as "${expectedBranch}".`,
    );
  }

  return currentBranch;
}

function ensureProductionBranch(branch) {
  if (allowProductionBranches.includes(branch)) return;
  throw new Error(
    `Production deployment blocked from branch "${branch}". Allowed branches: ${allowProductionBranches.join(", ")}.`,
  );
}

function ensureRemoteIsCurrent(branch) {
  fetchGitRemote();

  if (!remoteBranchExists(branch)) {
    throw new Error(
      `Remote branch "${gitRemote}/${branch}" does not exist. Push the branch before deploying.`,
    );
  }

  const divergence = getAheadBehind(branch);
  if (divergence.behind > 0 && divergence.ahead > 0) {
    throw new Error(
      `Branch "${branch}" has diverged from "${gitRemote}/${branch}". Resolve the divergence before deploying.`,
    );
  }
  if (divergence.behind > 0) {
    throw new Error(
      `Branch "${branch}" is behind "${gitRemote}/${branch}" by ${divergence.behind} commit(s). Pull the latest changes before deploying.`,
    );
  }
  if (divergence.ahead > 0) {
    console.log(
      `Pushing ${divergence.ahead} local commit(s) to ${gitRemote}/${branch}...`,
    );
    runCommand("git", ["push", "--set-upstream", gitRemote, branch]);
  }

  console.log(
    `Git branch "${branch}" is synchronised with ${gitRemote}/${branch}.`,
  );
}

function getShortCommitHash() {
  return captureCommand("git", ["rev-parse", "--short", "HEAD"]);
}

function getLatestCommitSubject() {
  return captureCommand("git", ["log", "-1", "--pretty=%s"]);
}

function printGitStatus() {
  ensureGitRepository();

  const branch = getCurrentBranch();
  const remoteUrl = getRemoteUrl();
  const status = getWorkingTreeStatus();

  console.log("");
  console.log("Git status");
  console.log("----------------------------------------");
  console.log(`Branch: ${branch}`);
  console.log(`Remote: ${gitRemote}`);
  console.log(`Remote URL: ${remoteUrl || "Not configured"}`);
  console.log(`Working tree: ${status ? "Uncommitted changes" : "Clean"}`);

  if (status) {
    console.log("");
    console.log(status);
  }

  if (remoteExists()) {
    fetchGitRemote();
    if (remoteBranchExists(branch)) {
      const divergence = getAheadBehind(branch);
      console.log(`Ahead: ${divergence.ahead}`);
      console.log(`Behind: ${divergence.behind}`);
    } else {
      console.log(`Remote branch: ${gitRemote}/${branch} does not exist`);
    }
  }

  console.log("----------------------------------------");
  console.log("");
}

function initialiseGitRepository() {
  if (!commandExists("git", ["--version"])) {
    throw new Error("Git is not installed or is not available on PATH.");
  }

  const insideWorkTree = captureCommand(
    "git",
    ["rev-parse", "--is-inside-work-tree"],
    { allowFailure: true },
  );

  if (insideWorkTree !== "true") runCommand("git", ["init"]);

  const branch = getCurrentBranch();
  if (configuredGitBranch && branch !== configuredGitBranch) {
    runCommand("git", ["branch", "-M", configuredGitBranch]);
  }

  console.log("");
  console.log("Local Git repository is ready.");
  console.log(
    "Add your enterprise repository with npm run git:remote -- <repository-url>",
  );
  console.log("");
}

function configureGitRemote(repositoryUrl) {
  if (!repositoryUrl) {
    throw new Error(
      "Repository URL missing. Usage: npm run git:remote -- <repository-url>",
    );
  }

  ensureGitRepository();

  if (remoteExists()) {
    runCommand("git", ["remote", "set-url", gitRemote, repositoryUrl]);
    console.log(`Git remote "${gitRemote}" updated to ${repositoryUrl}.`);
    return;
  }

  runCommand("git", ["remote", "add", gitRemote, repositoryUrl]);
  console.log(`Git remote "${gitRemote}" configured as ${repositoryUrl}.`);
}

function saveToGit(commitMessage) {
  ensureGitRepository();
  const branch = ensureExpectedBranch();

  if (!hasWorkingTreeChanges()) {
    console.log("No Git changes to commit.");
    return;
  }
  if (!commitMessage) {
    throw new Error(
      'Commit message missing. Usage: npm run save -- "Description of changes"',
    );
  }

  runCommand("git", ["add", "--all"]);
  runCommand("git", ["commit", "-m", commitMessage]);

  if (!remoteExists()) {
    console.log("");
    console.log("Commit created locally.");
    console.log(
      `Remote "${gitRemote}" is not configured, so the commit was not pushed.`,
    );
    return;
  }

  fetchGitRemote();
  if (remoteBranchExists(branch)) {
    const divergence = getAheadBehind(branch);
    if (divergence.behind > 0) {
      throw new Error(
        `Commit created locally, but push was blocked because "${branch}" is behind "${gitRemote}/${branch}". Rebase or merge the remote changes, then push.`,
      );
    }
  }

  runCommand("git", ["push", "--set-upstream", gitRemote, branch]);
  console.log(`Changes committed and pushed to ${gitRemote}/${branch}.`);
}

function selectPacEnvironment(config) {
  runCommand("pac", ["env", "select", "--environment", config.envId]);
}

function pull(config, skipGit) {
  if (!skipGit) {
    ensureGitRepository();

    if (hasWorkingTreeChanges()) {
      throw new Error(
        "Power Pages pull blocked because the working tree contains uncommitted changes. Commit, stash or discard them first, or use --nogit to bypass Git validation.",
      );
    }

    const branch = ensureExpectedBranch();
    if (requireRemoteSync && remoteExists()) {
      fetchGitRemote();
      if (remoteBranchExists(branch)) {
        const divergence = getAheadBehind(branch);
        if (divergence.behind > 0 || divergence.ahead > 0) {
          throw new Error(
            `Power Pages pull blocked because "${branch}" is not synchronised with "${gitRemote}/${branch}". Ahead: ${divergence.ahead}, behind: ${divergence.behind}.`,
          );
        }
      }
    }
  }

  console.log(`Pulling ${config.name} site...`);
  console.log(`Download directory: ${baseFolder}`);

  if (skipGit) {
    console.log(
      "Git validation: Bypassed with --nogit. Existing local Power Pages files may be overwritten.",
    );
  }

  fs.mkdirSync(baseFolder, { recursive: true });
  selectPacEnvironment(config);
  runCommand("pac", [
    "pages",
    "download",
    "--path",
    baseFolder,
    "--websiteId",
    config.siteId,
    "--overwrite",
    "true",
  ]);

  console.log(`${config.name} pull complete.`);

  if (skipGit) {
    console.log("");
    console.log(
      "Power Pages files were downloaded without checking the Git working tree.",
    );
    console.log(
      'Review the resulting changes, then run npm run save -- "Pull latest Power Pages changes"',
    );
    return;
  }

  if (hasWorkingTreeChanges()) {
    console.log("");
    console.log("Power Pages changes were downloaded.");
    console.log(
      'Review them, then run npm run save -- "Pull latest Power Pages changes"',
    );
  } else {
    console.log("No file changes were detected.");
  }
}

function validateDeploymentSource(config, skipGit) {
  if (skipGit) {
    return {
      branch: "Not checked",
      commitHash: "Not checked",
      commitSubject: "Git validation bypassed with --nogit",
      gitBypassed: true,
    };
  }

  ensureGitRepository();
  const branch = ensureExpectedBranch();

  if (config.key === "prod") ensureProductionBranch(branch);
  if (requireCleanDeploy) ensureCleanWorkingTree();
  if (requireRemoteSync) ensureRemoteIsCurrent(branch);

  return {
    branch,
    commitHash: getShortCommitHash(),
    commitSubject: getLatestCommitSubject(),
    gitBypassed: false,
  };
}

function push(config, validatedSource, skipGit) {
  const source =
    validatedSource || validateDeploymentSource(config, skipGit === true);
  const uploadPath = getSiteFolderPath(baseFolder);

  if (!fs.existsSync(uploadPath)) {
    throw new Error(
      `Power Pages upload directory does not exist: ${uploadPath}`,
    );
  }

  console.log("");
  console.log(`Pushing to ${config.name}...`);
  console.log(`Target directory: ${uploadPath}`);

  if (source.gitBypassed) {
    console.log("Git validation: Bypassed with --nogit");
  } else {
    console.log(`Git branch: ${source.branch}`);
    console.log(`Git commit: ${source.commitHash}`);
    console.log(`Commit subject: ${source.commitSubject}`);
  }

  console.log("");
  selectPacEnvironment(config);
  runCommand("pac", [
    "pages",
    "upload",
    "-mv",
    "Enhanced",
    "--path",
    uploadPath,
  ]);

  console.log("");
  console.log(`${config.name} push complete.`);

  if (source.gitBypassed) {
    console.log("Deployment completed without Git validation.");
  } else {
    console.log(
      `Deployed Git commit ${source.commitHash} from branch "${source.branch}".`,
    );
  }
}

function printUsage() {
  console.error(`
Usage:

  npm run git:init
  npm run git:remote -- <repository-url>
  npm run git:status

  npm run pull:dev
  npm run pull:dev -- --nogit
  npm run pull:prod
  npm run pull:prod -- --nogit

  npm run save -- "Commit message"

  npm run push:dev
  npm run push:dev -- --nogit
  npm run push:prod
  npm run push:prod -- --nogit
`);
}

(async () => {
  try {
    switch (command) {
      case "git:init":
        initialiseGitRepository();
        break;
      case "git:remote":
        configureGitRemote(filteredCommandArguments[0]);
        break;
      case "git:status":
        printGitStatus();
        break;
      case "save":
        saveToGit(filteredCommandArguments.join(" "));
        break;
      case "pull:dev":
        ensureRequiredTools(!noGit);
        pull(getEnvironmentConfig("dev"), noGit);
        break;
      case "push:dev":
        ensureRequiredTools(!noGit);
        push(getEnvironmentConfig("dev"), null, noGit);
        break;
      case "pull:prod":
        ensureRequiredTools(!noGit);
        pull(getEnvironmentConfig("prod"), noGit);
        break;
      case "push:prod": {
        ensureRequiredTools(!noGit);
        const productionConfig = getEnvironmentConfig("prod");
        const productionSource = validateDeploymentSource(
          productionConfig,
          noGit,
        );
        await confirmProductionPush();
        push(productionConfig, productionSource, noGit);
        break;
      }
      default:
        printUsage();
        process.exitCode = 1;
    }
  } catch (error) {
    console.error("");
    console.error(`Execution failed: ${error.message}`);
    console.error("");
    process.exitCode = 1;
  }
})();
