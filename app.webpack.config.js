const webpackConfig = require('./webpack.config.js');
const webpack = require('webpack');
const { readFileSync, readdirSync } = require('fs');
const { join, relative, resolve } = require('path');
const nsWebpack = require('@nativescript/webpack');
const CopyPlugin = require('copy-webpack-plugin');
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');
const SentryCliPlugin = require('@sentry/webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');

module.exports = (env, params = {}) => {
    if (env.adhoc) {
        env = Object.assign(
            {},
            {
                production: true,
                sentry: true,
                uploadSentry: true,
                sourceMap: true,
                uglify: true
            },
            env
        );
    }
    const nconfig = require('./nativescript.config');
    const {
        appPath = nconfig.appPath,
        appResourcesPath = nconfig.appResourcesPath,
        hmr, // --env.hmr
        production, // --env.production
        sourceMap, // --env.sourceMap
        hiddenSourceMap, // --env.hiddenSourceMap
        inlineSourceMap, // --env.inlineSourceMap
        sentry, // --env.sentry
        uploadSentry,
        verbose, // --env.verbose
        uglify, // --env.uglify
        noconsole, // --env.noconsole
        cartoLicense = false, // --env.cartoLicense
        devlog, // --env.devlog
        fakeall, // --env.fakeall
        fork = true, // --env.fakeall
        adhoc // --env.adhoc
    } = env;

    const config = webpackConfig(env, params);
    const mode = production ? 'production' : 'development';
    const platform = env && ((env.android && 'android') || (env.ios && 'ios'));
    const tsconfig = 'tsconfig.json';
    const projectRoot = params.projectRoot || __dirname;
    const dist = resolve(projectRoot, nsWebpack.getAppPath(platform, projectRoot));
    const appResourcesFullPath = resolve(projectRoot, appResourcesPath);

    if (!production) {
        config.stats = {
            warningsFilter: /export .* was not found in/
        };
    } else {
        config.stats = 'verbose';
    }

    if (platform === 'android') {
        // env.appComponents = [resolve(projectRoot, 'app/common/services/android/BgService.ts'), resolve(projectRoot, 'app/common/services/android/BgServiceBinder.ts')];
    }

    // safe as long as we dont use calc in css
    // config.externals.push('reduce-css-calc');

    const coreModulesPackageName = fork ? '@akylas/nativescript' : '@nativescript/core';
    config.resolve.modules = [resolve(__dirname, `node_modules/${coreModulesPackageName}`), resolve(__dirname, 'node_modules'), `node_modules/${coreModulesPackageName}`, 'node_modules'];
    Object.assign(config.resolve.alias, {
        '@nativescript/core': `${coreModulesPackageName}`,
        'tns-core-modules': `${coreModulesPackageName}`
    });

    console.log('coreModulesPackageName', coreModulesPackageName);

    // const coreModulesPackageName = '@nativescript/core';
    // config.resolve.modules = [
    //     resolve(__dirname, `node_modules/${coreModulesPackageName}`),
    //     resolve(__dirname, 'node_modules'),
    //     `node_modules/${coreModulesPackageName}`,
    //     'node_modules'
    // ];

    // Object.assign(config.resolve.alias, {
    //     '@nativescript/core': `${coreModulesPackageName}`,
    //     'tns-core-modules': `${coreModulesPackageName}`
    // });

    const package = require('./package.json');
    const nsconfig = require('./nativescript.config.js');
    const isIOS = platform === 'ios';
    const isAndroid = platform === 'android';
    const APP_STORE_ID = process.env.IOS_APP_ID;
    const CUSTOM_URL_SCHEME = 'alpimaps';
    const locales = readdirSync(join(projectRoot, appPath, 'i18n'))
        .filter((s) => s.endsWith('.json'))
        .map((s) => s.replace('.json', ''));
    // console.log('locales', locales);
    const defines = {
        PRODUCTION: !!production,
        process: 'global.process',
        'global.TNS_WEBPACK': 'true',
        'gVars.platform': `"${platform}"`,
        'global.isIOS': isIOS,
        'global.autoRegisterUIModules': false,
        'global.isAndroid': isAndroid,
        'gVars.internalApp': false,
        'gVars.packageServiceEnabled': cartoLicense,
        TNS_ENV: JSON.stringify(mode),
        SUPPORTED_LOCALES: JSON.stringify(locales),
        'gVars.sentry': !!sentry,
        NO_CONSOLE: noconsole,
        SENTRY_DSN: `"${process.env.SENTRY_DSN}"`,
        SENTRY_PREFIX: `"${!!sentry ? process.env.SENTRY_PREFIX : ''}"`,
        GIT_URL: `"${package.repository}"`,
        SUPPORT_URL: `"${package.bugs.url}"`,
        CUSTOM_URL_SCHEME: `"${CUSTOM_URL_SCHEME}"`,
        STORE_LINK: `"${
            isAndroid
                ? `https://play.google.com/store/apps/details?id=${nsconfig.id}`
                : `https://itunes.apple.com/app/id${APP_STORE_ID}`
        }"`,
        STORE_REVIEW_LINK: `"${
            isIOS
                ? ` itms-apps://itunes.apple.com/WebObjects/MZStore.woa/wa/viewContentsUserReviews?id=${APP_STORE_ID}&onlyLatestVersion=true&pageNumber=0&sortOrdering=1&type=Purple+Software`
                : `market://details?id=${nsconfig.id}`
        }"`,
        DEV_LOG: !!devlog,
        TEST_LOGS: !!adhoc || !production
    };
    const keys = require(resolve(__dirname, 'API_KEYS')).keys;
    Object.keys(keys).forEach((s) => {
        if (s === 'ios' || s === 'android') {
            if (s === platform) {
                Object.keys(keys[s]).forEach((s2) => {
                    defines[`gVars.${s2}`] = `'${keys[s][s2]}'`;
                });
            }
        } else {
            defines[`gVars.${s}`] = `'${keys[s]}'`;
        }
    });

    const itemsToClean = [`${dist}/**/*`];
    if (platform === 'android') {
        itemsToClean.push(`${join(projectRoot, 'platforms', 'android', 'app', 'src', 'main', 'assets', 'snapshots/**/*')}`);
        itemsToClean.push(
            `${join(projectRoot, 'platforms', 'android', 'app', 'build', 'configurations', 'nativescript-android-snapshot')}`
        );
    }

    const symbolsParser = require('scss-symbols-parser');
    const mdiSymbols = symbolsParser.parseSymbols(
        readFileSync(resolve(projectRoot, 'node_modules/@mdi/font/scss/_variables.scss')).toString()
    );
    const mdiIcons = JSON.parse(
        `{${mdiSymbols.variables[mdiSymbols.variables.length - 1].value.replace(/" (F|0)(.*?)([,\n]|$)/g, '": "$1$2"$3')}}`
    );
    // const osmSymbols = symbolsParser.parseSymbols(readFileSync(resolve(projectRoot, 'css/osm.scss')).toString());
    // console.log('osmSymbols', osmSymbols);
    // const osmIcons = JSON.parse(
    //     `{${osmSymbols.variables[osmSymbols.variables.length - 1].value.replace(
    //         /'osm-([a-zA-Z0-9-_]+)' (F|f|e|0)(.*?)([,\n]+|$)/g,
    //         '"$1": "$2$3"$4'
    //     )}}`
    // );

    const scssPrepend = `$mdi-fontFamily: ${platform === 'android' ? 'materialdesignicons-webfont' : 'Material Design Icons'};`;
    const scssLoaderRuleIndex = config.module.rules.findIndex((r) => Array.isArray(r.use) && r.use.indexOf('sass-loader') !== -1);
    config.module.rules.splice(
        scssLoaderRuleIndex,
        1,
        {
            test: /app\.scss$/,
            use: [
                {
                    loader: '@nativescript/webpack/helpers/css2json-loader',
                    options: { useForImports: true }
                },
                {
                    loader: 'postcss-loader',
                    options: {
                        postcssOptions: {
                            plugins: [
                                [
                                    'cssnano',
                                    {
                                        preset: 'advanced'
                                    }
                                ],
                                ['postcss-combine-duplicated-selectors', { removeDuplicatedProperties: true }]
                            ]
                        }
                    }
                },
                {
                    loader: 'sass-loader',
                    options: {
                        sourceMap: false,
                        additionalData: scssPrepend
                    }
                }
            ]
        },
        {
            test: /\.module\.scss$/,
            use: [
                { loader: 'css-loader', options: { url: false } },
                {
                    loader: 'sass-loader',
                    options: {
                        sourceMap: false,
                        additionalData: scssPrepend
                    }
                }
            ]
        }
    );

    config.module.rules.push({
        // rules to replace mdi icons and not use nativescript-font-icon
        test: /\.(ts|js|scss|css|svelte)$/,
        exclude: /node_modules/,
        use: [
            {
                loader: 'string-replace-loader',
                options: {
                    search: 'mdi-([a-z-]+)',
                    replace: (match, p1, offset, str) => {
                        if (mdiIcons[p1]) {
                            return String.fromCharCode(parseInt(mdiIcons[p1], 16));
                        }
                        return match;
                    },
                    flags: 'g'
                }
            }
            // {
            //     loader: 'string-replace-loader',
            //     options: {
            //         search: 'osm-([a-zA-Z0-9-_]+)',
            //         replace: (match, p1, offset) => {
            //             if (osmIcons[p1]) {
            //                 return String.fromCharCode(parseInt(osmIcons[p1], 16));
            //             }
            //             return match;
            //         },
            //         flags: 'g'
            //     }
            // }
        ]
    });
    if (!!production) {
        config.module.rules.push({
            // rules to replace mdi icons and not use nativescript-font-icon
            test: /\.(js)$/,
            use: [
                {
                    loader: 'string-replace-loader',
                    options: {
                        search: '__decorate\\(\\[((.|\n)*?)profile,((.|\n)*?)\\],.*?,.*?,.*?\\);?',
                        replace: (match, p1, offset, string) => '',
                        flags: 'g'
                    }
                }
            ]
        });
        // rules to clean up all Trace in production
        // we must run it for all files even node_modules
        config.module.rules.push({
            test: /\.(ts|js)$/,
            use: [
                {
                    loader: 'string-replace-loader',
                    options: {
                        search: 'if\\s*\\(\\s*Trace.isEnabled\\(\\)\\s*\\)',
                        replace: 'if (false)',
                        flags: 'g'
                    }
                }
            ]
        });
    }
    // we remove default rules
    config.plugins = config.plugins.filter(
        (p) =>
            ['DefinePlugin', 'CleanWebpackPlugin', 'CopyPlugin', 'Object', 'ForkTsCheckerWebpackPlugin'].indexOf(
                p.constructor.name
            ) === -1
    );
    // we add our rules
    const copyOptions = { ignore: [`**/${relative(appPath, appResourcesFullPath)}/**`] };
    const copyPatterns = [
        { from: 'fonts/!(ios|android)/**/*', to: 'fonts', flatten: true, noErrorOnMissing: true, globOptions: { dot: false } },
        { from: 'fonts/*', to: 'fonts', flatten: true, noErrorOnMissing: true, globOptions: { dot: false } },
        { from: `fonts/${platform}/**/*`, to: 'fonts', flatten: true, noErrorOnMissing: true, globOptions: { dot: false } },
        { from: '**/*.jpg', noErrorOnMissing: true, globOptions: { dot: false } },
        { from: '**/*.png', noErrorOnMissing: true, globOptions: { dot: false } },
        { from: 'assets/**/*', noErrorOnMissing: true, globOptions: { dot: false } },
        { from: 'i18n/**/*', noErrorOnMissing: true, globOptions: { dot: false } },
        {
            from: '../node_modules/@mdi/font/fonts/materialdesignicons-webfont.ttf',
            to: 'fonts',
            noErrorOnMissing: true,
            globOptions: { dot: false }
        }
    ];
    config.plugins.unshift(new CopyPlugin(copyPatterns, copyOptions));

    // save as long as we dont use calc in css
    // config.plugins.push(new webpack.IgnorePlugin(/reduce-css-calc/));
    // config.plugins.unshift(
    //     new CleanWebpackPlugin({
    //         dangerouslyAllowCleanPatternsOutsideProject: true,
    //         dry: false,
    //         verbose: false,
    //         cleanOnceBeforeBuildPatterns: itemsToClean
    //     })
    // );
    config.plugins.unshift(new webpack.DefinePlugin(defines));
    config.plugins.push(
        new webpack.EnvironmentPlugin({
            NODE_ENV: JSON.stringify(mode), // use 'development' unless process.env.NODE_ENV is defined
            DEBUG: false
        })
    );

    config.plugins.push(new webpack.ContextReplacementPlugin(/dayjs[\/\\]locale$/, new RegExp(`(${locales.join('|')})$`)));
    if (fork && nsconfig.cssParser !== 'css-tree') {
            config.plugins.push(new webpack.IgnorePlugin(/css-tree$/));
    }

    config.devtool = inlineSourceMap ? 'inline-cheap-source-map' : false;
    if (!inlineSourceMap && (hiddenSourceMap || sourceMap)) {
        if (!!sentry && !!uploadSentry) {
            config.plugins.push(
                new webpack.SourceMapDevToolPlugin({
                    append: `\n//# sourceMappingURL=${process.env.SENTRY_PREFIX}[name].js.map`,
                    filename: join(process.env.SOURCEMAP_REL_DIR, '[name].js.map')
                })
            );
            let appVersion;
            let buildNumber;
            if (platform === 'android') {
                appVersion = readFileSync('app/App_Resources/Android/app.gradle', 'utf8').match(
                    /versionName "((?:[0-9]+\.?)+)"/
                )[1];
                buildNumber = readFileSync('app/App_Resources/Android/app.gradle', 'utf8').match(/versionCode ([0-9]+)/)[1];
            } else if (platform === 'ios') {
                appVersion = readFileSync('app/App_Resources/iOS/Info.plist', 'utf8').match(
                    /<key>CFBundleShortVersionString<\/key>[\s\n]*<string>(.*?)<\/string>/
                )[1];
                buildNumber = readFileSync('app/App_Resources/iOS/Info.plist', 'utf8').match(
                    /<key>CFBundleVersion<\/key>[\s\n]*<string>([0-9]*)<\/string>/
                )[1];
            }
            console.log('appVersion', appVersion, buildNumber);

            config.plugins.push(
                new SentryCliPlugin({
                    release: appVersion,
                    urlPrefix: 'app:///',
                    rewrite: true,
                    dist: `${buildNumber}.${platform}`,
                    ignore: ['tns-java-classes', 'hot-update'],
                    include: [dist, join(dist, process.env.SOURCEMAP_REL_DIR)]
                })
            );
        } else {
            config.plugins.push(
                new webpack.SourceMapDevToolPlugin({
                    filename: '[name].js.map'
                })
            );
        }
    }
    if (!!production) {
        config.plugins.push(
            new ForkTsCheckerWebpackPlugin({
                async: false,
                typescript: {
                    configFile: resolve(tsconfig)
                }
            })
        );
    }

    config.optimization.minimize = uglify !== undefined ? !!uglify : production;
    const isAnySourceMapEnabled = !!sourceMap || !!hiddenSourceMap || !!inlineSourceMap;
    config.optimization.minimizer = [
        new TerserPlugin({
            parallel: true,
            cache: true,
            sourceMap: isAnySourceMapEnabled,
            terserOptions: {
                ecma: 2017,
                module: true,
                output: {
                    comments: false,
                    semicolons: !isAnySourceMapEnabled
                },
                compress: {
                    // The Android SBG has problems parsing the output
                    // when these options are enabled
                    collapse_vars: platform !== 'android',
                    sequences: platform !== 'android',
                    passes: 2,
                    drop_console: production && adhoc !== true
                },
                keep_fnames: true
            }
        })
    ];
    return config;
};