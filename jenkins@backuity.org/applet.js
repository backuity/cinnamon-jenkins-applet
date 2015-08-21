const Applet = imports.ui.applet;
const Util = imports.misc.util;

const Lang = imports.lang
// http://developer.gnome.org/glib/unstable/glib-The-Main-Event-Loop.html
const Mainloop = imports.mainloop
const Gtk = imports.gi.Gtk
const Json = imports.gi.Json

const PopupMenu = imports.ui.popupMenu
const Settings = imports.ui.settings

// http://developer.gnome.org/st/stable/
const St = imports.gi.St

// http://developer.gnome.org/libsoup/stable/libsoup-client-howto.html
const Soup = imports.gi.Soup

const UUID = "jenkins@backuity.org"
const MAX_JOB = 15


// Settings keys
//----------------------------------

const JENKINS_REFRESH_INTERVAL = 'refreshInterval'
const JENKINS_SSL_STRICT = 'sslStrict'
const JENKINS_URL = 'jenkinsUrl'
const JENKINS_USERNAME = 'jenkinsUsername'
const JENKINS_PASSWORD = 'jenkinsPassword'

const KEYS = [
  JENKINS_REFRESH_INTERVAL,
  JENKINS_SSL_STRICT,
  JENKINS_URL,
  JENKINS_USERNAME,
  JENKINS_PASSWORD
]

// Soup session (see https://bugzilla.gnome.org/show_bug.cgi?id=661323#c64)
const _httpSession = new Soup.Session()
Soup.Session.prototype.add_feature.call(_httpSession, new Soup.ProxyResolverDefault())

function MyApplet(metadata, orientation, panel_height, instance_id) {
    this.settings = new Settings.AppletSettings(this, UUID, instance_id);
    this._init(metadata, orientation, panel_height, instance_id);
}

MyApplet.prototype = {
    __proto__: Applet.TextIconApplet.prototype,

    _init: function(metadata, orientation, panel_height, instance_id) {
        Applet.TextIconApplet.prototype._init.call(this, orientation, panel_height, instance_id);

        Gtk.IconTheme.get_default().append_search_path(metadata.path);

        // Interface: TextIconApplet
        this.set_applet_icon_name('jenkins-grey');
        this.set_applet_label('...');
        this.set_applet_tooltip(_('Jenkins status'));

        // bind settings
        //----------------------------------

        for (let k in KEYS) {
            let key = KEYS[k]
            let keyProp = "_" + key
            this.settings.bindProperty(Settings.BindingDirection.IN, key, keyProp,
                                       this.refreshAndRebuild, null)
        }

        // http auth if needed
        //----------------------------------

        let applet = this        
        _httpSession.connect("authenticate",function(session,message,auth,retrying) {
            log("Authenticating with " + applet._jenkinsUsername);
            auth.authenticate(applet._jenkinsUsername, applet._jenkinsPassword);
        });        

        // PopupMenu
        //----------------------------------

        this.menuManager = new PopupMenu.PopupMenuManager(this)
        this.menu = new Applet.AppletPopupMenu(this, orientation)
        // this.menu.actor.add_style_class_name(STYLE_WEATHER_MENU)
        this.menuManager.addMenu(this.menu)

        this.menu.addMenuItem(new PopupMenu.PopupMenuItem(_('Loading jobs...')));

        //------------------------------
        // run
        //------------------------------
        Mainloop.timeout_add_seconds(3, Lang.bind(this, function mainloopTimeout() {
          this.refreshBuildStatuses(true)
        }))
      }

    , on_applet_clicked: function() {
        this.menu.toggle();
    }

    , refreshAndRebuild: function() {
        refreshBuildStatuses(false);
    }

    , refreshBuildStatuses: function(recurse) {
        log("Loading " + this.jenkinsUrl());
        this.loadJsonAsync(this.jenkinsUrl(), function(json) {  
            this.destroyMenu();          
            try {
                let jobs = json.get_array_member('jobs').get_elements();                
                let names = '';
                let maxJobs = Math.min(jobs.length,MAX_JOB);
                let success = 0;
                for (let i = 0; i < jobs.length; i ++) {
                    if( jobs[i].get_object().get_string_member('color') == 'blue') {
                        success += 1;
                    }
                }
                this.set_applet_label('' + success + '/' + jobs.length);

                if( success < jobs.length ) {
                    this.set_applet_icon_name('jenkins-red');
                }

                for (let i = 0; i < maxJobs; i ++) {                                        
                    let job = jobs[i].get_object();

                    let jobName = job.get_string_member('name');
                    let color = job.get_string_member('color');
                    let success = color == 'blue';                    
                    let url = job.get_string_member('url');  
                    // log("Found job " + jobName + " color=" + color + " success=" + success + " url=" + url)

                    this.menu.addMenuItem(new JobMenuItem(jobName, success, url));                    
                }
                
            } catch(error) {
                this.set_applet_icon_name('jenkins-grey');
                this.set_applet_label('!');                                
                logError(error.message)
                this.menu.addMenuItem(new PopupMenu.PopupMenuItem(error.message));
            }
        })

        if (recurse) {
            Mainloop.timeout_add_seconds(this._refreshInterval, Lang.bind(this, function() {
                this.refreshBuildStatuses(true)
            }))
        }
    }

    , destroyMenu: function() {
        this.menu.removeAll();
    }

    , jenkinsUrl: function() {        
        let output =  this._jenkinsUrl + '/api/json';
        return output;
    }

    , loadJsonAsync: function(url, callback) {
        let applet = this;
        let message = Soup.Message.new('GET', url);
        _httpSession.ssl_strict = this._sslStrict;
        _httpSession.queue_message(message, function soupQueue(session, message) {
          
          if( message.status_code != 200 ) {
            logError("Got status " + message.status_code + " " + message.response_body.data);
            applet.destroyMenu();
            applet.set_applet_label('!');
            applet.set_applet_icon_name('jenkins-grey');
            applet.menu.addMenuItem(new PopupMenu.PopupMenuItem(message.response_body.data));
          } else {
              let jp = new Json.Parser()
              jp.load_from_data(message.response_body.data, -1)
              callback.call(applet, jp.get_root().get_object())
          }
        })
    }
};


function JobMenuItem(name, success, url) {
    this._init(name, success, url);
}

JobMenuItem.prototype = {
    __proto__: PopupMenu.PopupBaseMenuItem.prototype,

    _init: function(name, success, url) {
        PopupMenu.PopupBaseMenuItem.prototype._init.call(this);

        this.label = new St.Label({ text: name });
        this.addActor(this.label);

        let iconName = 'jenkins-green';
        if( !success ) {
            iconName = 'jenkins-red';
        }        

        let statusIcon = new St.Icon({ icon_name: iconName, icon_type: St.IconType.FULLCOLOR, style_class: 'popup-menu-icon' });
        this.addActor(statusIcon);

        this.connect('activate', Lang.bind(this, function (menuItem, event) {
            Util.spawnCommandLine("xdg-open " + url);
        }));
    }    
};


// Logging
//----------------------------------------------------------------------

function log(message) {
  global.log(UUID + "#" + log.caller.name + ": " + message)
}

function logError(error) {
  global.logError(UUID + "#" + logError.caller.name + ": " + error)
}


// Entry point
//----------------------------------------------------------------------

function main(metadata, orientation, panel_height, instance_id) {
    return new MyApplet(metadata, orientation, panel_height, instance_id);
}


