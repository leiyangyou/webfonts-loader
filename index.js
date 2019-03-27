var loaderUtils = require('loader-utils');
var webfontsGenerator = require('webfonts-generator');
var VirtualModuleWebpackPlugin = require('virtual-module-webpack-plugin');
var path = require('path');
var glob = require('glob');

function getFilesAndDeps (patterns, context) {
  var files = [];
  var filesDeps = [];
  var directoryDeps = [];

  function addFile (file) {
    filesDeps.push(file);
    files.push(path.resolve(context, file));
  }

  function addByGlob (globExp) {
    var globOptions = {
      cwd: context
    };

    var foundFiles = glob.sync(globExp, globOptions);
    files = files.concat(foundFiles.map(file => {
      return path.resolve(context, file);
    }));

    var globDirs = glob.sync(path.dirname(globExp) + '/', globOptions);
    directoryDeps = directoryDeps.concat(globDirs.map(file => {
      return path.resolve(context, file);
    }));
  }

  // Re-work the files array.
  patterns.forEach(function (pattern) {
    if (glob.hasMagic(pattern)) {
      addByGlob(pattern);
    } else {
      addFile(pattern);
    }
  });

  return {
    files: files,
    dependencies: {
      directories: directoryDeps,
      files: filesDeps
    }
  };
}

// Futureproof webpack option parsing
function wpGetOptions (context) {
  if (typeof context.query === 'string') return loaderUtils.getOptions(context);
  return context.query;
}

module.exports = function (content) {
  this.cacheable();

  const { atime, ctime, mtime } = this.fs.statSync(this.resourcePath);

  var options = wpGetOptions(this) || {};
  var rawFontConfig;
  try {
    rawFontConfig = JSON.parse(content);
  } catch (ex) {
    rawFontConfig = this.exec(content, this.resourcePath);
  }
  var fontConfig = Object.assign({}, options, rawFontConfig);

  var filesAndDeps = getFilesAndDeps(fontConfig.files, this.context);
  filesAndDeps.dependencies.files.forEach(this.addDependency.bind(this));
  filesAndDeps.dependencies.directories.forEach(this.addContextDependency.bind(this));
  fontConfig.files = filesAndDeps.files;
  fontConfig.cssFontsPath = fontConfig.cssFontsPath || './';

  // With everything set up, let's make an ACTUAL config.
  var formats = fontConfig.types || ['eot', 'woff', 'woff2', 'ttf', 'svg'];
  if (formats.constructor !== Array) {
    formats = [formats];
  }

  var generatorOptions = {
    files: fontConfig.files,
    fontName: fontConfig.fontName,
    types: formats,
    order: formats,
    fontHeight: fontConfig.fontHeight || 1000, // Fixes conversion issues with small svgs,
    codepoints: fontConfig.codepoints || {},
    templateOptions: {
      baseSelector: fontConfig.baseSelector || '.icon',
      classPrefix: 'classPrefix' in fontConfig ? fontConfig.classPrefix : 'icon-'
    },
    scssFile: fontConfig.scssFile || false,
    dest: fontConfig.dest || '',
    html: fontConfig.html || false,
    htmlDest: fontConfig.htmlDest || undefined,
    writeFiles: fontConfig.writeFiles || false,
    cssFontsUrl: fontConfig.cssFontsPath || './',
    formatOptions: fontConfig.formatOptions || {}
  };

  // Add key only if it exists in config object to avoid fs errors
  if ('htmlTemplate' in fontConfig) {
    generatorOptions.htmlTemplate = fontConfig.htmlTemplate;
  }

  // This originally was in the object notation itself.
  // Unfortunately that actually broke my editor's syntax-highlighting...
  // ... what a shame.
  if (typeof fontConfig.rename === 'function') {
    generatorOptions.rename = fontConfig.rename;
  } else {
    generatorOptions.rename = function (f) {
      return path.basename(f, '.svg');
    };
  }

  if (fontConfig.cssTemplate) {
    generatorOptions.cssTemplate = path.resolve(this.context, fontConfig.cssTemplate);
  }

  if (fontConfig.htmlTemplate) {
    generatorOptions.htmlTemplate = path.resolve(this.context, fontConfig.htmlTemplate);
  }

  if (fontConfig.htmlDest) {
    generatorOptions.htmlDest = path.resolve(this.context, fontConfig.htmlDest);
  }

  if (fontConfig.dest) {
    generatorOptions.dest = path.resolve(this.context, fontConfig.dest);
  }

  // Spit out SCSS file to same path as CSS file to easily use mixins (scssFile must be true)
  if (fontConfig.scssFile === true) {
    generatorOptions.cssDest = path.resolve(this.context, fontConfig.dest, fontConfig.fontName + '.scss');
  }

  // svgicons2svgfont stuff
  var keys = [
    'fixedWidth',
    'centerHorizontally',
    'normalize',
    'fontHeight',
    'round',
    'descent'
  ];
  for (var x in keys) {
    if (typeof fontConfig[keys[x]] !== 'undefined') {
      generatorOptions[keys[x]] = fontConfig[keys[x]];
    }
  }

  var cb = this.async();

  if (generatorOptions.cssTemplate) {
    this.addDependency(generatorOptions.cssTemplate);
  }

  webfontsGenerator(generatorOptions, (err, res) => {
    if (err) {
      return cb(err);
    }
    var urls = {};
    for (var i in formats) {
      var format = formats[i];
      var filename = '[fontname].[ext]';

      filename = filename
        .replace('[fontname]', generatorOptions.fontName)
        .replace('[ext]', format);

      const modulePath = path.resolve(this.context, fontConfig.cssFontsPath, filename);

      urls[format] = filename;

      const mapIsAvailable = typeof Map !== 'undefined';
      const readFileStorageIsMap = mapIsAvailable && this.fs._readFileStorage.data instanceof Map;

      if (readFileStorageIsMap) { // enhanced-resolve@3.4.0 or greater
        this.fs._readFileStorage.data.delete(modulePath);
      } else if (this.fs._readFileStorage.data[modulePath]) { // enhanced-resolve@3.3.0 or lower
        delete this.fs._readFileStorage.data[modulePath];
      }

      VirtualModuleWebpackPlugin.populateFilesystem({ fs: this.fs, modulePath, contents: res[format], ctime, mtime, atime });
    }

    var emitCodepointsOptions = fontConfig.emitCodepoints || options.emitCodepoints || null;
    if (emitCodepointsOptions) {
      const emitCodepoints = require('./emit-codepoints');
      emitCodepoints.emitFiles(this, emitCodepointsOptions, generatorOptions, options);
    }

    cb(null, res.generateCss(urls));
  });
};
