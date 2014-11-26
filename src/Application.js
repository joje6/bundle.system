var path = require('path');
var fs = require('fs');
var npm = require("npm");

npm.on('log', function(message) {
	console.log('log:' + message);
});

var Plugin = require('./Plugin.js');
var semver = require('semver');
var PluginManager = require('./PluginManager.js');
var Workspace = require('./Workspace.js');
var ApplicationError = require('./ApplicationError.js');
var EventEmitter = require('events').EventEmitter;

if( !String.prototype.startsWith ) {
	String.prototype.startsWith = function(s) {
		if( !s ) return false;
		return (this.indexOf(s)==0);
	};
}

if( !String.prototype.endsWith ) {
	String.prototype.endsWith = function(s) {
		if( !s ) return false;

		return this.indexOf(s, this.length - s.length) !== -1;
	};
}

if( !String.prototype.trim ) {
	String.prototype.trim = function() {
		return this.replace(/(^ *)|( *$)/g, "");
	};
}

var rmdirRecursive = function(path) {
    var files = [];
    if( fs.existsSync(path) ) {
        files = fs.readdirSync(path);
        files.forEach(function(file,index){
            var curPath = path + "/" + file;
            if(fs.lstatSync(curPath).isDirectory()) { // recurse
                rmdirRecursive(curPath);
            } else { // delete file
                fs.unlinkSync(curPath);
            }
        });
        fs.rmdirSync(path);
    }
};

var Application = function(homedir, argv) {
	if( !homedir ) throw new Error('missing home directory', homedir);
	
	if( argv && argv.dev ) this.devmode = true;
	if( argv && argv.debug ) this.debug = true;
	
	this.ee = new EventEmitter();
	
	if( this.debug ) {
		this.on('loaded', function() {
			console.log('* plexi application loaded');
		}).on('detected', function(plugin) {
			console.log('* [' + plugin.identity + '] plugin detected!');
		}).on('bound', function(plugin) {
			console.log('* [' + plugin.identity + '] plugin bound!');
		}).on('started', function(plugin) {
			console.log('* [' + plugin.identity + '] plugin started!');
		}).on('stopped', function(plugin) {
			console.log('* [' + plugin.identity + '] plugin stopped!');
		}).on('detect-error', function(plugin) {
			console.log('* [' + plugin.identity + '] plugin error!');
		}).on('require', function(pluginId, plugin, caller, exports) {
			console.log('* [' + caller.identity + '] plugin require "' + pluginId + '" [' + plugin.identity + ']');
			console.log('\texports: ', exports);
		});
	}
	
	this.load(homedir, argv);
};

Application.prototype = {
	load: function(homedir, argv) {
		var home = this.HOME = homedir;
		
		var pkg = require(path.join(home, 'package.json'));
		var plexi = pkg.plexi || {};
		var dependencies = plexi.dependencies || {};
		
		var preferences, env;
		
		// read preference file
		if( true ) {		
			var pref_js_file = path.join(home, 'plexi.js');
			var pref_json_file = path.join(home, 'plexi.json');
			
			if( fs.existsSync(pref_js_file) && fs.statSync(pref_js_file).isFile() ) {
				preferences = require(pref_js_file);
				this.PREFERENCES_FILE = pref_js_file;
			} else if( fs.existsSync(pref_json_file) && fs.statSync(pref_json_file).isFile() ) {
				preferences = require(pref_json_file);
				this.PREFERENCES_FILE = pref_json_file;
			} else {
				preferences = {};
			}
		}
		
		// read env
		env = preferences.env || {};
		
		this.PLUGINS_DIR = path.join(home, env['plugins.dir'] || 'plexi_modules');
		this.WORKSPACE_DIR = path.join(home, env['workspace.dir'] || 'workspace');
		
		//if( !fs.existsSync(this.PLUGINS_DIR) ) fs.mkdirSync(this.PLUGINS_DIR);
		//if( !fs.existsSync(this.WORKSPACE_DIR) ) fs.mkdirSync(this.WORKSPACE_DIR);
		
		try {
			preferences = JSON.stringify(preferences);
			for(var k in properties) {
				var value = properties[k] || '';
				preferences = preferences.split('{' + k + '}').join(value);
			}
			
			preferences = preferences.split('\\').join('/');
			preferences = JSON.parse(preferences);
		} catch(err) {
			throw new ApplicationError('application_load_error:config_file_parse:' + pref_file + ':' + err.message, err);
		}
		
		// read properties
		var properties = {};
		if( typeof(argv) === 'object' ) {
			for( var key in argv ) {
				if( !key || !argv.hasOwnProperty(key) ) continue;
				properties[key] = argv[key];
			}
		}		
		
		if( preferences.properties ) {
			for( var key in preferences.properties ) {
				if( !key || !preferences.properties.hasOwnProperty(key) ) continue;
				properties[key] = preferences.properties[key];
			}
		}
		
		properties['home'] = this.HOME;
		properties['preferences.file'] = this.PREFERENCES_FILE;
		properties['workspace.dir'] = this.WORKSPACE_DIR;
		properties['plugins.dir'] = this.PLUGINS_DIR;
	
		// setup instance attributes
		this.links = plexi.links || {};
		this.properties = properties;
		this.preferences = preferences.preferences || {};
		this.workspaces = {};
		this.plugins = new PluginManager(this);
		
		// set host plugin
		this.plugins.host(new Plugin(this, process.cwd()));
		
		this.detect();
		this.emit('loaded', this);
	},
	detect: function() {		
		if( !fs.existsSync(this.PLUGINS_DIR) ) return;
	
		var files = fs.readdirSync(this.PLUGINS_DIR);
	
		for(var i=0; i < files.length; i++) {
			var dirname = files[i];
			
			if( dirname.startsWith('-') || !~dirname.indexOf('@') ) continue;
	
			var dir = path.join(this.PLUGINS_DIR, dirname);
			var stat = fs.statSync(dir);
			if( stat.isDirectory() ) {
				var plugin = new Plugin(this, dir);
				this.plugins.add(plugin);
			}
		}
		
		// devmode 라면 links 를 활성화
		if( this.devmode ) {
			var links = this.links;
			for(var pluginId in links) {
				var pathes = links[pluginId];
				if( pathes ) {
					if( !Array.isArray(pathes) ) pathes = [pathes];
					
					for(var i=0; i < pathes.length; i++) {
						var dir = pathes[i];
						var plugin = new Plugin(this, dir);
						this.plugins.add(plugin);
					}
				}
			}
		}
	},
	start: function() {
		var host = this.plugins.host();
		if( host ) host.start();
		this.emit('application-started', this);
		return this;
	},
	plugins: function() {
		return this.plugins;
	},
	workspace: function(pluginId) {
		if( !pluginId ) throw new ApplicationError('missing:pluginId');

		if( typeof(pluginId) === 'object' && pluginId.pluginId ) {
			pluginId = pluginId.pluginId;
		}

		if( typeof(pluginId) !== 'string' ) throw new ApplicationError('invalid:pluginId:' + pluginId);

		var ws = this.workspaces[pluginId];
		if( !ws ) {
			ws = new Workspace(this.WORKSPACE_DIR, pluginId);
			this.workspaces[pluginId] = ws;
		}

		return ws;
	},
	preference: function(pluginId, version) {
		var prefs = this.preferences;
		if( prefs ) {			
			var pref = prefs[pluginId];
			
			if( version ) {
				pref = prefs[pluginId + '@' + version] || pref;
			}
			
			if( pref ) return JSON.parse(JSON.stringify(pref));
		}

		return null;
	},
	on: function(type, fn) {
		this.ee.on(type, fn);
		return this;
	},
	once: function(type, fn) {
		this.ee.once(type, fn);
		return this;
	},
	off: function(type, fn) {
		this.ee.off(type, fn);
		return this;
	},
	emit: function() {
		this.ee.emit.apply(this.ee, arguments);
		return this;
	}
};


module.exports = Application;
