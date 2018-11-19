const fs                = require('fs');
const CLI               = require('commander');
const path              = require('path');
const pkg               = require('../package.json');
const chalk             = require('chalk');
const gulp              = require('gulp');
const bsSP              = require('browser-sync').create();
const tap               = require('gulp-tap');
const iconizer          = require('../modules/gulp-iconizer');

const babel             = require('gulp-babel');
const uglify            = require('gulp-uglify');

const nunjucks          = require('../modules/nunjucks');
const frontMatter       = require('gulp-front-matter');

const postHTML          = require('gulp-posthtml');
const svgSprite         = require('gulp-svg-sprite');

const stylus            = require('gulp-stylus');
const postcss           = require('gulp-postcss');
const focus             = require('postcss-focus');
const flexBugsFixes     = require('postcss-flexbugs-fixes');
const momentumScrolling = require('postcss-momentum-scrolling');
const autoprefixer      = require('autoprefixer');
const cssnano           = require('cssnano');
const sass              = require('gulp-sass');
const sassGlob          = require('gulp-sass-glob');

const sourcemaps        = require('gulp-sourcemaps');
const gif               = require('gulp-if');
const LOG               = require('fancy-log');
const plumber           = require('gulp-plumber');
const groupMQ           = require('gulp-group-css-media-queries');
const changed           = require('gulp-changed');
const concat            = require('gulp-concat');
const include           = require('gulp-include');

const decache           = require('decache');
const pipeErrorStop     = require('pipe-error-stop');
const del               = require('del');

const TCI               = require('../modules/tci');

const getAuthParams     = (params) => typeof params !== 'string' ? [pkg.name, false] : params.split('@');
const getIconsNamesList = (path) => {
    let iconsList = [];
    
    if (fs.existsSync(path)) {
        iconsList =  fs.readdirSync(path).map((iconName) => iconName.replace(/.svg/g, ''));
    }

    return iconsList
} ;
const getNunJucksBlocks = (blocksPath) => fs.readdirSync(blocksPath).map((el) => blocksPath + '/' + el);

/**
 * Проверка правильности установки логина и пароля для авторизации
 */
// bsSP.use(require('bs-auth'), {
//     user : getAuthParams(CLI.auth)[0],
//     pass : getAuthParams(CLI.auth)[1],
//     use  : CLI.auth
// });

let settings = require(`${process.cwd()}/marmelad/settings.marmelad`);
let database = {};
let isNunJucksUpdate = false;

module.exports = (opts) => {

    TCI.run();

    /**
     * NUNJUCKS
     */
    gulp.task('nunjucks', (done) => {

        let templateName = '',
            error = false;

        let stream = gulp.src(`${settings.paths._pages}/**/*.html`)
            .pipe(plumber())
            .pipe(gif(!isNunJucksUpdate, changed(settings.paths.dist)))
            .pipe(tap((file) => {
                templateName = path.basename(file.path);
            }))
            .pipe(frontMatter())
            .pipe(nunjucks({
                searchPaths: getNunJucksBlocks(settings.paths._blocks),
                locals: database,
                ext: '.html',
                setUp: function(env) {

                    env.addFilter('translit', require('../modules/nunjucks/filters/translit'));
                    env.addFilter('limitto', require('../modules/nunjucks/filters/lomitto'));

                    return env;
                }
            }))
            .pipe(pipeErrorStop({
                errorCallback: (err) => {
                    error = true;
                    console.log(`\n${err.name}: ${err.message.replace(/(unknown path)/, templateName)}\n`);
                },
                successCallback: () => {
                    error = false;
                    isNunJucksUpdate = false;
                }
            }))
            .pipe(iconizer({
                path: `${settings.paths.iconizer.src}/sprite.svg`,
                _beml : settings.app.beml
            }))
            .pipe(postHTML([
                require('posthtml-bem')(settings.app.beml),
            ]))
            .pipe(gulp.dest(settings.paths.dist));

        stream.on('end', () => {

            LOG(`NunJucks ${chalk.gray('............................')} ${error ? chalk.bold.red('ERROR\n') : chalk.bold.green('Done')}`);

            bsSP.reload();
            done();
        });

        stream.on('error', (err) => {
            done(err);
        });
    });

    /**
     * DB
     */
    gulp.task('db', (done) => {

        let dataPath = `${process.cwd()}/marmelad/data.marmelad.js`;

        decache(dataPath);

        database = require(dataPath);

        Object.assign(database.app, {
            package  : pkg,
            settings : settings,
            storage  : settings.folders.storage,
            icons    : getIconsNamesList(settings.paths.iconizer.icons)
        });

        isNunJucksUpdate = true;

        LOG(`DB for templates .................... ${chalk.bold.yellow('Refreshed')}`);

        done();

    });

    /**
     * DB:update
     */
    gulp.task('db:update', (done) => {
        gulp.series('db', 'styles', 'nunjucks')(done);
    });



    /**
     * Iconizer
     */
    gulp.task('iconizer', (done) => {

        let stream = gulp.src(`${settings.paths.iconizer.icons}/*.svg`)
            .pipe(svgSprite(settings.app.svgSprite))
            .pipe(gulp.dest('.'));

        stream.on('end', () => {

            Object.assign(database, {
                app : {
                    icons : getIconsNamesList(settings.paths.iconizer.icons)
                }
            });

            LOG(`Iconizer ............................ ${chalk.bold.green('Done')}`);

            done();
        });

        stream.on('error', (err) => {
            done(err);
        });
    });

    /**
     * Iconizer update
     */
    gulp.task('iconizer:update', (done) => {

        isNunJucksUpdate = true;

        gulp.series('iconizer', 'db:update')(done);
    });


    /**
     * scripts from blocks
     */
    gulp.task('scripts:others', (done) => {

        let stream = gulp.src(`${settings.paths.js.src}/*.js`)
            .pipe(plumber())
            .pipe(include({
                extensions: 'js',
                hardFail: false
            })).on('error', LOG)
            .pipe(babel({
                presets: ['@babel/preset-env'].map(require.resolve),
                plugins: ['@babel/plugin-transform-object-assign'].map(require.resolve),
            }))
            .pipe(gulp.dest(`${settings.paths.storage}/${settings.folders.js.src}`));

        stream.on('end', () => {
            LOG(`Scripts others ...................... ${chalk.bold.green('Done')}`);
            bsSP.reload();
            done();
        });

        stream.on('error', (err) => {
            done(err);
        });
    });

    /**
     * СКРИПТЫ ВЕНДОРНЫЕ
     */
    gulp.task('scripts:vendors', (done) => {

        let vendorsDist = `${settings.paths.storage}/${settings.folders.js.src}/${settings.folders.js.vendors}`;

        let stream = gulp.src(settings.paths.js.vendors + '/**/*.js')
            .pipe(plumber())
            .pipe(changed(vendorsDist))
            .pipe(gulp.dest(vendorsDist));

        stream.on('end', () => {
            LOG(`Scripts vendors ..................... ${chalk.bold.green('Done')}`);
            bsSP.reload();
            done();
        });

        stream.on('error', (err) => {
            done(err);
        });

    });

    /**
     * СКРИПТЫ ПЛАГИНОВ
     */
    gulp.task('scripts:plugins', (done) => {

        let stream = gulp.src(settings.paths.js.plugins + '/**/*.js')
            .pipe(plumber())
            .pipe(concat('plugins.min.js'))
            .pipe(uglify())
            .pipe(gulp.dest(`${settings.paths.storage}/${settings.folders.js.src}`));

        stream.on('end', () => {
            LOG(`Scripts plugins ..................... ${chalk.bold.green('Done')}`);
            bsSP.reload();
            done();
        });

        stream.on('error', (err) => {
            done(err);
        });

    });

    /**
     * СТИЛИ ПЛАГИНОВ
     */
    gulp.task('styles:plugins', (done) => {

        gulp.src(`${settings.paths.js.plugins}/**/*.css`)
            .pipe(plumber())
            .pipe(concat('plugins.min.css'))
            .pipe(groupMQ())
            .pipe(postcss([
                focus(),
                momentumScrolling(),
                flexBugsFixes(),
                cssnano({ zindex:false })
            ], { from: undefined } ))
            .pipe(gulp.dest(`${settings.paths.storage}/css`))
            .on('end', () => {
                LOG(`Plugins CSS ......................... ${chalk.bold.green('Done')}`);
            })
            .pipe(bsSP.stream());

        done();

    });

    /**
     * сборка стилей блоков, для каждого отдельный css
     */

    gulp.task('styles', (done) => {

        let $data = {
            beml : settings.app.beml
        };

        Object.assign($data, database.app.stylus);

        gulp.src(`${settings.paths.styles}/*.{styl,scss,sass}`)
            .pipe(plumber())
            .pipe(gif('*.styl', stylus({
                'include css': true,
                rawDefine : { $data }
            })))
            .pipe(gif('*.scss', sassGlob()))
            .pipe(gif('*.scss', sass()))
            .pipe(gif('*.sass', sass({
                indentedSyntax: true
            })))
            .pipe(groupMQ())
            .pipe(postcss([
                focus(),
                momentumScrolling(),
                flexBugsFixes(),
                autoprefixer(settings.app.autoprefixer)
            ], { from: undefined } ))
            .pipe(gif('*.min.css', postcss([
                cssnano(settings.app.cssnano)
            ])))
            .pipe(gulp.dest(`${settings.paths.storage}/css`))
            .on('end', () => {
                LOG(`Styles CSS .......................... ${chalk.bold.green('Done')}`);
            })
            .pipe(bsSP.stream());

        done();
    });

    /**
     * СТАТИКА
     */
    gulp.task('static', (done) => {

        let stream = gulp.src([
            settings.paths.static + '/**/*.*',
            '!' + settings.paths.static + '/**/Thumbs.db',
            '!' + settings.paths.static + '/**/*tmp*'
        ])
            .pipe(plumber())
            .pipe(changed(settings.paths.storage))
            .pipe(gulp.dest(settings.paths.storage));

        stream.on('end', () => {
            LOG(`Static files copy ................... ${chalk.bold.green('Done')}`);
            bsSP.reload();
            done();
        });

        stream.on('error', (err) => {
            done(err);
        });
    });

    /**
     * static server
     */
    gulp.task('server:static', (done) => {

        bsSP.init(settings.app.bsSP, () => {

            let urls = bsSP.getOption('urls'),
                bsAuth = bsSP.getOption('bsAuth'),
                authString = '';

            if (bsAuth && bsAuth.use) {
                authString = `\n  user: ${bsAuth.user}\npass: ${bsAuth.pass}`;
            }

            console.log(authString);

            done();
        });
    });

    /** ^^^
     * Bootstrap 4 tasks
     ==================================================================== */
    gulp.task('bootstrap', (done) => {

        if (settings.app.bts.use) {
            gulp.series('bts4:sass', 'bts4:js')();
        }
        
        done();
    });

    gulp.task('bts4:sass', (done) => {

        gulp.src(`${settings.app.bts['4'].src.css}/scss/[^_]*.scss`)
            .pipe(sourcemaps.init())
            .pipe(sass(settings.app.bts['4'].sass))
            .pipe(postcss([
                momentumScrolling(),
                autoprefixer(settings.app.bts['4'].autoprefixer)
            ]))
            .pipe(sourcemaps.write('./'))
            .pipe(gulp.dest(settings.app.bts['4'].dest.css))
            .on('end', () => {
                LOG(`Bootstrap ${settings.app.bts['4'].code} SASS ........... ${chalk.bold.green('Done')}`);
            })
            .pipe(bsSP.stream());

            done();
    });

    gulp.task('bts4:js', (done) => {

        let stream = gulp.src(`${settings.app.bts['4'].src.js}/**/*.js`)
            .pipe(plumber())
            .pipe(changed(settings.app.bts['4'].dest.js))
            .pipe(gulp.dest(settings.app.bts['4'].dest.js));

        stream.on('end', () => {
            LOG(`Bootstrap ${settings.app.bts['4'].code} JS ............. ${chalk.bold.green('Done')}`);
            bsSP.reload();
            done();
        });

        stream.on('error', (err) => {
            done(err);
        });

    });

    gulp.task('watch', (done) => {

        const watchOpts = {
            ignoreInitial: true,
            ignored: [
                `${settings.folders.marmelad}/**/*.db`,
                `${settings.folders.marmelad}/**/*tmp*`,
            ],
            usePolling: true,
            cwd: process.cwd(),
        };

        if (settings.app.bts.use) {

            /* SCSS */
            gulp.watch(
                `${settings.app.bts['4'].src.css}/**/*.scss`,
                watchOpts,
                gulp.parallel('bts4:sass')
            );
        
            /* JS */
            gulp.watch(
                `${settings.app.bts['4'].src.js}/**/*.js`,
                watchOpts,
                gulp.parallel('bts4:js')
            );
        }

        /* СТАТИКА */
        gulp.watch(
            `${settings.paths.static}/**/*.*`,
            watchOpts,
            gulp.parallel('static')
        );

        /* STYLES */
        gulp.watch([
                `${settings.paths._blocks}/**/*.{styl,scss,sass}`,
                `${settings.paths.styles}/**/*.{styl,scss,sass}`,
            ],
            watchOpts,
            gulp.parallel('styles')
        );

        /* СКРИПТЫ */
        gulp.watch(
            `${settings.paths.js.vendors}/**/*.js`,
            watchOpts,
            gulp.parallel('scripts:vendors')
        );

        gulp.watch(
            `${settings.paths.js.plugins}/**/*.js`,
            watchOpts,
            gulp.parallel('scripts:plugins')
        );

        gulp.watch([
                `${settings.paths.js.src}/*.js`,
                `${settings.paths._blocks}/**/*.js`
            ],
            watchOpts,
            gulp.parallel('scripts:others')
        );

        gulp.watch(
            `${settings.paths.js.plugins}/**/*.css`,
            watchOpts,
            gulp.parallel('styles:plugins')
        );

        /* NunJucks Pages */
        gulp.watch(
            `${settings.paths._pages}/**/*.html`,
            watchOpts,
            gulp.parallel('nunjucks')
        );

        /* NunJucks Blocks */
        gulp.watch([
                `${settings.paths._blocks}/**/*.html`
            ], watchOpts, (done) => {
                isNunJucksUpdate = true;
                gulp.series('nunjucks')(done);
            }
        );

        /* NunJucks database */
        gulp.watch(
            `${settings.paths.marmelad}/data.marmelad.js`,
            watchOpts,
            gulp.parallel('db:update')
        );


        /* Iconizer */
        gulp.watch(
            `${settings.paths.iconizer.icons}/*.svg`,
            watchOpts,
            gulp.parallel('iconizer:update')
        );
        
        done();
    });

    /**
     * очищаем папку сборки перед сборкой Ж)
     */
    gulp.task('clean', (done) => {
        del.sync(settings.paths.dist);
        done();
    });

    gulp.task(
        'develop',
        gulp.series(
            'clean',
            'server:static',
            'static',
            'iconizer',
            'db',
            gulp.parallel(
                'nunjucks',
                'scripts:vendors',
                'scripts:plugins',
                'scripts:others',
                'styles:plugins',
                'styles',
                'bootstrap',
            ),
            'watch',
        ),
    );

    gulp.series('develop')();
}