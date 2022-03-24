#!/usr/bin/env node

// nS - No Space
// lC - Lowercase

import colors from 'colors';
import fs from 'fs';
import program from 'commander';
import replace from 'node-replace';
import shell from 'shelljs';
import pjson from '../package.json';
import path from 'path';
import { bundleIdentifiers } from './config/bundleIdentifiers';
import { loadAppConfig, loadAndroidManifest, __dirname } from './utils';

const androidEnvs = ['main', 'debug'];
const projectName = pjson.name;
const projectVersion = pjson.version;
const replaceOptions = {
  recursive: true,
  silent: true,
};

function replaceContent(regex, replacement, paths) {
  replace({
    regex,
    replacement,
    paths,
    recursive: true,
    silent: true,
  });

  for (const filePath of paths) {
    console.log(`${filePath.replace(__dirname, '')} ${colors.green('MODIFIED')}`);
  }
}

const cleanBuilds = () => {
  const deleteDirectories = shell.rm('-rf', [
    path.join(__dirname, 'android/.gradle/*'),
    path.join(__dirname, 'android/app/build/*'),
    path.join(__dirname, 'android/build/*'),
  ]);

  console.log('Done removing builds.'.green);

  return Promise.resolve(deleteDirectories);
};

loadAppConfig()
  .then(appConfig => {
    program
      .version(projectVersion)
      .arguments('[newName]')
      .option('-b, --bundleID [value]', 'Set custom bundle identifier eg. "com.junedomingo.travelapp"')
      .action(argName => {
        const newName = argName || currentAppName;
        const pattern = /^([\p{Letter}\p{Number}])+([\p{Letter}\p{Number}\s]+)$/u;
        const bundleID = program.bundleID ? program.bundleID.toLowerCase() : null;
        let newBundlePath;
       

        if (bundleID) {
          newBundlePath = bundleID.replace(/\./g, '/');
          const id = bundleID.split('.');
          const validBundleID = /^([a-zA-Z]([a-zA-Z0-9_])*\.)+[a-zA-Z]([a-zA-Z0-9_])*$/u;
          if (id.length < 2) {
            return console.log(
              'Invalid Bundle Identifier. Add something like "com.travelapp" or "com.junedomingo.travelapp"'
            );
          }
          if (!validBundleID.test(bundleID)) {
            return console.log(
              'Invalid Bundle Identifier. It must have at least two segments (one or more dots). Each segment must start with a letter. All characters must be alphanumeric or an underscore [a-zA-Z0-9_]'
            );
          }
        }

        if (!pattern.test(newName)) {
          return console.log(
            `"${newName}" is not a valid name for a project. Please use a valid identifier name (alphanumeric and space).`
          );
        }

    
        const resolveBundleIdentifiers = params => {
          const { currentBundleID, newBundleID, newBundlePath } = params;

          const promises = bundleIdentifiers({
            currentAppName,
            newName,
            projectName,
            currentBundleID,
            newBundleID,
            newBundlePath,
          }).map(file =>
            Promise.all(
              file.paths.map(
                filePath =>
                  new Promise(resolve => {
                    const newPaths = [];
                    if (fs.existsSync(path.join(__dirname, filePath))) {
                      newPaths.push(path.join(__dirname, filePath));
                      replaceContent(file.regex, file.replacement, newPaths);
                    }
                    resolve();
                  })
              )
            )
          );

          return Promise.all(promises);
        };

        const resolveJavaFiles = () =>
          new Promise(resolve => {
            loadAndroidManifest().then($data => {
              const currentBundleID = $data('manifest').attr('package');
              const newBundleID = program.bundleID ? bundleID : currentBundleID;

              const promises = androidEnvs.map(env => {
                return new Promise(envResolve => {
                  const javaFileBase = `android/app/src/${env}/java`;

                  const newJavaPath = `${javaFileBase}/${newBundleID.replace(/\./g, '/')}`;
                  const currentJavaPath = `${javaFileBase}/${currentBundleID.replace(/\./g, '/')}`;
                  const shouldDelete = !newJavaPath.includes(currentJavaPath);

                  if (bundleID) {
                    newBundlePath = newJavaPath;
                  } else {
                    newBundlePath = newBundleID.replace(/\./g, '/').toLowerCase();
                    newBundlePath = `${javaFileBase}/${newBundlePath}`;
                  }

                  const fullCurrentBundlePath = path.join(__dirname, currentJavaPath);
                  const fullNewBundlePath = path.join(__dirname, newBundlePath);

                  shell.mkdir('-p', fullNewBundlePath);

                  const successMsg = `${newBundlePath} ${colors.green('BUNDLE IDENTIFIER CHANGED')}`;

                  const shellMove = shell.mv('-f', fullCurrentBundlePath + '/*', fullNewBundlePath);
                  // if "outside repository" error occured
                  if (shellMove.code === 0) {
                    console.log(successMsg);
                  } else {
                    console.log(`Error moving: "${currentJavaPath}" "${newBundlePath}"`);
                  }

                  if (shouldDelete) {
                    shell.rm('-rf', fullCurrentBundlePath);
                  }

                  const vars = {
                    currentBundleID,
                    newBundleID,
                    newBundlePath,
                    javaFileBase,
                    currentJavaPath,
                    newJavaPath,
                  };

                  return resolveBundleIdentifiers(vars).then(envResolve);
                });
              });

              return Promise.all(promises).then(resolve);
            });
          });

       
        const run = () =>
          Promise.resolve()
            .then(resolveJavaFiles)
            .then(cleanBuilds)
            .then(() => console.log(`APP SUCCESSFULLY RENAMED TO "${newName}"! 🎉 🎉 🎉`.green))
            .then(() => {
              if (fs.existsSync(path.join(__dirname, 'ios', 'Podfile'))) {
                console.log(
                  `${colors.yellow('Podfile has been modified, please run "pod install" inside ios directory.')}`
                );
              }
            })
            .then(() =>
              console.log(
                `${colors.yellow(
                  'Please make sure to run "watchman watch-del-all" and "npm start --reset-cache" before running the app.'
                )}`
              )
            );

        return run().catch(error => {
          console.log(colors.red(error));
        });
      })
      .parse(process.argv);

    if (!process.argv.slice(2).length) {
      program.outputHelp();
    }
  })
  .catch(err => {
    if (err.code === 'ENOENT') {
      return console.log('Directory should be created using "react-native init"');
    }

    return console.log('Something went wrong: ', err);
  });
