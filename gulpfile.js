var os = require('os');
var del = require('del');
var path = require('path');
var exec = require('child_process').exec;
var gulp = require('gulp');
var gutil = require('gulp-util');
var shell = require('gulp-shell');
var gulpFile = require('gulp-file');
var webpack = require('webpack');
var webpackConfig = require('./webpack.config.js');
var runSequence = require('run-sequence');

var conventionalChangelog = require('gulp-conventional-changelog');
var conventionalGithubReleaser = require('conventional-github-releaser');
var bump = require('gulp-bump');
var git = require('gulp-git');
var fs = require('fs');
var argv = require('yargs')
    .option('type', {
        alias: 't',
        choices: ['patch', 'minor', 'major']
    })
    .argv;
var typedoc = require('gulp-typedoc');
var template = require('gulp-md-template');
var rename = require('gulp-rename');
var replace = require('gulp-replace');




const LIBRARY_NAME = 'ng2-scrollreveal';

//Helper functions
function platformPath(path) {
    return /^win/.test(os.platform()) ? `${path}.cmd` : path;
}

function webpackCallBack(taskName, gulpDone) {
    return function (err, stats) {
        if (err) throw new gutil.PluginError(taskName, err);
        gutil.log(`[${taskName}]`, stats.toString({
            colors: true
        }));
        gulpDone();
    }
}

// Cleaning Tasks
gulp.task('clean:build', function () { return del('dist/'); });
gulp.task('clean:lib', function () { return del('dist/lib'); });
gulp.task('clean:doc', function () { return del('dist/doc'); });
gulp.task('clean:demo', function () { return del('dist/demo'); });

// Transpiling & Building

gulp.task('ngc', function (cb) {
    var executable = path.join(__dirname, platformPath('/node_modules/.bin/ngc'));
    exec(`${executable} -p ./src/lib/tsconfig-es2015.json`, (e) => {
        if (e) console.log(e);
        del('./dist/waste');
        cb();
    }).stdout.on('data', function (data) { console.log(data); });
});

gulp.task('umd', function (cb) {
    // run webpack
    webpack(webpackConfig, webpackCallBack('webpack', cb));
});

gulp.task('npm', function () {
    var pkgJson = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
    var targetPkgJson = {};
    var fieldsToCopy = ['version', 'description', 'keywords', 'author', 'repository', 'license', 'bugs', 'homepage'];

    targetPkgJson['name'] = LIBRARY_NAME;

    fieldsToCopy.forEach(function (field) { targetPkgJson[field] = pkgJson[field]; });

    targetPkgJson['main'] = `bundles/${LIBRARY_NAME}.min.js`;
    targetPkgJson['module'] = 'index.js';
    targetPkgJson['typings'] = 'index.d.ts';

    targetPkgJson.peerDependencies = {};
    Object.keys(pkgJson.dependencies).forEach(function (dependency) {
        targetPkgJson.peerDependencies[dependency] = `^${pkgJson.dependencies[dependency]}`;
    });

    return gulp.src('README.md')
        .pipe(gulpFile('package.json', JSON.stringify(targetPkgJson, null, 2)))
        .pipe(gulp.dest('dist/lib'));
});


gulp.task('typedoc', function () {
    return gulp
        .src(['src/lib/**/*.ts', '!src/lib/**/*.spec.ts'])
        .pipe(typedoc({
            // TypeScript options (see typescript docs) 
            mode: 'modules',
            ignoreCompilerErrors: true,
            experimentalDecorators: true,
            emitDecoratorMetadata: true,
            target: 'es6',
            moduleResolution: 'node',
            preserveConstEnums: true,
            stripInternal: true,
            suppressExcessPropertyErrors: true,
            suppressImplicitAnyIndexErrors: true,
            module: 'commonjs',

            // Typedoc options
            name: 'ng2-scrollreveal API Doc',
            theme: 'default',
            out: './dist/doc',
            hideGenerator: true,
            excludeExternals: true,
            excludePrivate: true

        }));
});

// Demo Tasks
gulp.task('serve:demo', shell.task('ng serve'));

gulp.task('build:demo', ['md'], shell.task('ng build --prod'));

gulp.task('push:demo', shell.task('ng gh-pages:deploy --gh-username tinesoft'));

gulp.task('md', function () {
    return gulp.src('./src/demo/app/getting-started/getting-started.component.mt')
        .pipe(template('.'))
        .pipe(replace(/(<h1 id[^>]+>[^]+?)(<h2 id="installation">)/, '$2'))// strips everything between start to '<h2 id="installation">'
        .pipe(replace('{', "{{ '{' }}")) // escapes '{' for angular
        .pipe(rename({ extname: '.html' }))
        .pipe(gulp.dest('./src/demo/app/getting-started'));
});

// Release Tasks
gulp.task('changelog', function () {
    return gulp.src('CHANGELOG.md', { buffer: false })
        .pipe(conventionalChangelog({
            preset: 'angular', releaseCount: 1
        }))
        .pipe(gulp.dest('./'));
});

gulp.task('github-release', function (done) {
    conventionalGithubReleaser({
        type: 'oauth',
        token: gutil.env.GITHUB_TOKEN
    },
        { preset: 'angular' },
        done);
});

gulp.task('bump-version', function () {
    // We hardcode the version change type to 'patch' but it may be a good idea to
    // use minimist (https://www.npmjs.com/package/minimist) to determine with a
    // command argument whether you are doing a 'major', 'minor' or a 'patch' change.
    return gulp.src('./package.json')
        .pipe(bump({ type: argv.type || 'patch' }).on('error', gutil.log))
        .pipe(gulp.dest('./'));
});

gulp.task('commit-changes', function () {
    return gulp.src('.')
        .pipe(git.add())
        .pipe(git.commit('[Prerelease] Bumped version number'));
});

gulp.task('push-changes', function (cb) {
    git.push('origin', 'master', cb);
});

gulp.task('create-new-tag', function (cb) {
    var version = getPackageJsonVersion();
    git.tag(version, 'Created Tag for version: ' + version, function (error) {
        if (error) {
            return cb(error);
        }
        git.push('origin', 'master', { args: '--tags' }, cb);
    });

    function getPackageJsonVersion() {
        // We parse the json file instead of using require because require caches
        // multiple calls so the version number won't be updated
        return JSON.parse(fs.readFileSync('./package.json', 'utf8')).version;
    };
});

gulp.task('release', function (callback) {
    runSequence(
        'bump-version',
        'changelog',
        'commit-changes',
        'push-changes',
        'create-new-tag',
        'github-release',
        function (error) {
            if (error) {
                console.log(error.message);
            } else {
                console.log('RELEASE FINISHED SUCCESSFULLY');
            }
            callback(error);
        });
});

gulp.task('publish', function (done) {
    // run npm publish terminal command 
    exec('npm publish ./dist/lib',
        function (error, stdout, stderr) {
            if (stderr) {
                gutil.log(gutil.colors.red(stderr));
            } else if (stdout) {
                gutil.log(gutil.colors.green(stdout));
            }
            // execute callback when its done 
            if (done) {
                done();
            }
        }
    );
});

// Public Tasks
gulp.task('clean', ['clean:lib', 'clean:demo', 'clean:demo']);

gulp.task('test', shell.task('ng test --watch false'));

gulp.task('lint', shell.task('ng lint'));

gulp.task('build:lib', function (done) {
    runSequence(/*'lint', 'enforce-format', 'ddescribe-iit', */ 'clean:lib', 'test', 'ngc', 'umd', 'npm', done);
});

gulp.task(
    'deploy-demo', function (done) { runSequence('clean:demo', 'build:demo', 'push:demo', done); });

gulp.task(
    'deploy-lib', function (done) { runSequence('clean:lib', 'build:lib', 'release', 'publish', done); });

gulp.task('default', function (done) { runSequence('lint', /*'enforce-format', 'ddescribe-iit', */'test', done); });