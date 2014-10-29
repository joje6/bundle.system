var path = require('path');
var fs = require('fs');
var semver = require('semver');

var Bundle = require('./Bundle.js');
var ApplicationError = require('./ApplicationError.js');

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

var Application = function Application(home_dir, bundle_dir, workspace_dir, log_dir) {
	this.HOME = home_dir;
	this.PREFERENCE_FILE = path.join(this.HOME, 'plexi.json');	
	this.BUNDLE_HOME = bundle_dir || path.join(this.HOME, 'plugins');
	this.WORKSPACE_HOME = workspace_dir || path.join(this.HOME, 'workspace');
	this.LOG_DIR = log_dir || path.join(this.HOME, 'logs');

	this.load();
	this.detect();
	this.start();
};

Application.prototype = {
	load: function load() {		
		var pref_file = this.PREFERENCE_FILE;
		
		if( fs.existsSync(pref_file) && fs.statSync(pref_file).isFile() ) {
			var preference = fs.readFileSync(pref_file, 'utf-8');

			try {
				var o = JSON.parse(preference);
				
				if( typeof(o) !== 'object' )
					throw new ApplicationError('application_load_error:preference_invalid:' + pref_file);
				
				var props = o.properties;

				if( props ) {
					for(var k in props) {
						var value = props[k] || '';
						preference = preference.split('{' + k + '}').join(value);
					}
				}

				preference = preference.split('{home}').join(this.HOME);
				preference = preference.split('{preference.file}').join(this.PREFERENCE_FILE);
				preference = preference.split('{workspace.home}').join(this.WORKSPACE_HOME);
				preference = preference.split('{bundle.home}').join(this.BUNDLE_HOME);
				preference = preference.split('{log.dir}').join(this.LOG_DIR);
				preference = preference.split('\\').join('/');

				preference = JSON.parse(preference);
			} catch(err) {
				throw new ApplicationError('application_load_error:config_file_parse:' + pref_file + ':' + err.message, err);
			}
		
			// setup instance attributes
			this.preference = preference;
		} else {
			this.preference = {};
		}
		
		this.bundles = new BundleGroups();
		this.workspaces = {};
	},
	detect: function detect() {
		var files = fs.readdirSync(this.BUNDLE_HOME);

		for(var i=0; i < files.length; i++) {
			var dirname = files[i];
			
			if( dirname.startsWith('-') ) continue;
			
			var dir = path.join(this.BUNDLE_HOME, dirname);

			var stat = fs.statSync(dir);
			if( stat.isDirectory() ) {
				var bundle = new Bundle(this, dir);
				this.bundles.add(bundle);
				
				console.log('* detected', bundle.bundleId, bundle.version);
			}
		}
	},
	start: function start() {
		var preference = this.preference;
		var bundles = this.bundles.groups;
				
		for(var id in bundles) {
			var bundle = this.bundles.get(id);
			if( bundle.status === Bundle.STATUS_DETECTED ) bundle.start();
		}
	},
	getBundleWorkspace: function(bundleId) {
		if( !bundleId ) throw new ApplicationError('missing:bundleId');

		if( typeof(bundleId) === 'object' && bundleId.bundleId ) {
			bundleId = bundleId.bundleId;
		}

		if( typeof(bundleId) !== 'string' ) throw new ApplicationError('invalid:bundleId:' + bundleId);

		var ws = this.workspaces[bundleId];
		if( !ws ) {
			ws = new Workspace(path.join(this.WORKSPACE_HOME, bundleId));
			this.workspaces[bundleId] = ws;
		}

		return ws;
	},
	getBundleOptions: function(bundleId, version) {
		if( this.preference ) {
			var bundle_pref = this.preference[bundleId];
			if( bundle_pref ) {
				return JSON.parse(JSON.stringify(bundle_pref)).options;
			}
		}

		return null;
	},
	on: function(name, fn) {
	},
	un: function(name, fn) {
	}
};



// Bundle Workspace
var Workspace = function Workspace(dir) {
	this.dir = dir;
};

Workspace.prototype = {
	path: function(subpath) {
		if( !fs.existsSync(this.dir) ) {
			fs.mkdirSync(this.dir);
		}

		var file = path.join(this.dir, subpath)

		return file;
	},
	save: function(name, data, charset, options) {
		return {
			done: function(fn) {
			}
		};
	},
	load: function(name, charset, options) {
		return {
			done: function(fn) {
			}
		};
	}
};



// Bundle Groups
var BundleGroups = function BundleGroups() {
	this.groups = {};
};

BundleGroups.prototype = {
	add: function(bundle) {
		if( bundle instanceof Bundle ) {
			var id = bundle.bundleId;
			var group = this.groups[id];
			if( !group ) {
				group = new BundleGroup(id);
				this.groups[id] = group;
			}
			
			group.add(bundle);
		} else {
			throw new ApplicationError('invalid_bundle', bundle);
		}
	},
	all: function(bundleId) {
		var arg = [];
		
		if( arguments.length <= 0 ) {
			for(var bundleId in this.groups) {
				var group = this.groups[bundleId];
				if( group ) {
					var bundles = group.all();
					if( bundles && bundles.length > 0 ) arg = arg.concat(bundles);
				}
			}
		} else {
			var group = this.groups[bundleId];
			if( group ) {
				var bundles = group.all();
				if( bundles && bundles.length > 0 ) arg = arg.concat(bundles);
			}
		}

		return arg;
	},
	get: function(bundleId, version) {
		var group = this.groups[bundleId];
		if( group ) {
			return group.get(version);
		}

		return null;
	}
};

var BundleGroup = function BundleGroup(bundleId) {
	this.bundleId = bundleId;
	this.bundles = [];
};

BundleGroup.prototype = {
	/*
	*
	>1.0
	<1.0
	1.0.0
	1.0
	1.0.*
	1.*
	*/
	get: function(match) {
		if( !match || match === '*' ) return this.bundles[0];

		for(var i=0; i < this.bundles.length; i++) {
			var bundle = this.bundles[i];
			var version = bundle.version;

			if( semver.satisfies(version, match) ) {
				return bundle;
			}
		}

		return null;
	},
	master: function() {
		return this.bundles[0];
	},
	all: function() {
		return this.bundles;
	},
	add: function(bundle) {
		if( (bundle instanceof Bundle) && bundle.bundleId === this.bundleId ) {
			this.bundles.push(bundle);

			this.bundles.sort(function compare(a, b) {
				return semver.compare(b.version, a.version);
			});
		} else {
			throw new ApplicationError('incompatible_bundle:' + bundle.bundleId, bundle);
		}
	},
	toString: function() {
		return '[group:' + this.bundleId + ':' + this.bundles.length + ']';
	}
};

module.exports = Application;
