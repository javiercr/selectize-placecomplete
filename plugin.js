/**
 * Plugin: "placecomplete" (selectize.js)
 * @author @comerc (fork of placecomplete by Stephanie H. Chang <st@stchangg.com>)
 * fork me: https://github.com/comerc/selectize-placecomplete
 */
 
if (typeof require === "function") {
 var Selectize = require("selectize");
}

window.initPlacecomplete = function() {
  GooglePlacesAPI.completeInit();
};

/**
 * A wrapper to simplify communicating with and contain logic specific to the
 * Google Places API
 *
 * @return {object} An object with public methods getPredictions() and
 *                  getDetails()
 */
var GooglePlacesAPI = {

  deferred: new $.Deferred(),
  initialized: false,
  acService: null,
  pService: null,
  el: null,

  /**
   * Start loading Google Places API if it hasn't yet been loaded.
   *
   * @param  {HTMLDivElement} el
   *
   *     Container in which to "render attributions", according to
   *     https://developers.google.com/maps/documentation/javascript/reference#PlacesService.
   *     TODO: (stephanie) I still don't really understand why the element is
   *     necessary, hence why I'm only ever instantiating PlacesService
   *     once, no matter how many elements are initialized with the plugin.
   */
  init: function(el) {
    // Ensure init() is idempotent, just in case.
    if (this.initialized) {
      return;
    }

    // Store element so we can use it to intialize PlacesService in
    // completeInit()
    this.el = el;

    // Only fetch Google Maps API if it's not already loaded
    if (window.google && google.maps && google.maps.places) {
      // Skip to completeInit() directly
      this.completeInit();
    } else {
      $.ajax({
        // TODO: https://developers.google.com/maps/documentation/javascript/basics#Localization
        url: "https://maps.googleapis.com/maps/api/js?libraries=places&sensor=false&callback=initPlacecomplete",
        dataType: "script",
        cache: true
      });
    }
  },

  completeInit: function() {
    // AutocompleteService is needed for getting the list of options
    this.acService = new google.maps.places.AutocompleteService();

    // PlacesService is needed for getting details for the selected
    // option
    this.pService = new google.maps.places.PlacesService(this.el);

    this.initialized = true;
    this.deferred.resolve();
  },

  _handlePredictions: function(def, abbreviatedPlaceResults, status) {
    if (status !== google.maps.places.PlacesServiceStatus.OK) {
      def.reject(status);
      return;
    }
    def.resolve(abbreviatedPlaceResults);
  },

  _handleDetails: function(def, displayText, placeResult, status) {
    if (status !== google.maps.places.PlacesServiceStatus.OK) {
      def.reject(status);
      return;
    }
    placeResult["display_text"] = displayText;
    def.resolve(placeResult);
  },

  // Get list of autocomplete results for the provided search term
  getPredictions: function(searchTerm, requestParams) {
    return this.deferred.then($.proxy(function() {
      var deferred = new $.Deferred();
      if (typeof requestParams === "function")
      {
        requestParams = requestParams();
      }
      requestParams = $.extend({}, requestParams, {
        "input": searchTerm
      });
      this.acService.getPlacePredictions(
        requestParams,
        $.proxy(this._handlePredictions, null, deferred));
      return deferred.promise();
    }, this));
  },

  // Get details of the selected item
  getDetails: function(abbreviatedPlaceResult) {
    return this.deferred.then($.proxy(function() {
      var deferred = new $.Deferred();
      var displayText = abbreviatedPlaceResult.description;
      // FIXME: NOT_FOUND for "ChIJ--acWvtHDW0RF5miQ2HvAAU"-"Auckland, New Zealand"
      this.pService.getDetails({
        placeId: abbreviatedPlaceResult.place_id
      }, $.proxy(this._handleDetails, null, deferred, displayText));
      return deferred.promise();
    }, this));
  }
};

var pluginName = "placecomplete";

Selectize.define(pluginName, function(options) {
  var self = this;

  options = $.extend({
    placeholder: "City, State, Country",
    // Request parameters for the .getPlacePredictions() call
    // https://developers.google.com/maps/documentation/javascript/reference#AutocompletionRequest
    requestParams: {
      types: ["(cities)"]
    },
    filterResults: null,
  }, options);

  this.setup = (function() {
    var original = self.setup;
    return function() {
      if (options.placeholder)
        self.settings.placeholder = options.placeholder;
      original.apply(this, arguments);

      // Initialize
      GooglePlacesAPI.init(this.$input[0]);

      self.settings.load = function(query, callback) {
        if (!query.length) return callback();
        GooglePlacesAPI.getPredictions(query, options.requestParams)
          .done(function(aprs) {
            var results = $.map(aprs, function(apr) {
              // selectize needs a "text" and "value" property set
              // for each autocomplete list item.
              apr["value"] = apr["text"] = apr["description"];
              return apr;
            });
            callback(results);
          })
          .fail(function(errorMsg) {
            // TODO: how to get plugin name?
            self.trigger(pluginName + ":error", errorMsg);
            callback();
          });
      };
      var render_option = self.settings.render.option;
      self.settings.render.option = function(data) {
        // BUGFIX: "Россия, город Санкт-Петербург, Санкт-Петербург" >>> "Россия, Санкт-Петербург"
        var re, m;
        re = /(.*), (city|Stadt|ville|ciudad|città|cidade|город|城市|kota|grad|ciutat|město|by|mji|pilsēta|miestas|város|bandar|നഗരം|stad|miasto|oraș|qytet|mesto|град|kaupunki|lungsod|thành phố|şehir|πόλη|місто|עיר|शहर|เมือง|街|도시) (.*), (.*)/;
        m = re.exec(data.text);
        if (m && (m[1] === m[3] || m[3] === m[4])) {
          data.text = m[1] + ", " + m[4];
        }
        return render_option.apply(this, arguments);
      };
    };
  })();
  this.onOptionSelect = (function() {
    var original = self.onOptionSelect;
    return function(e) {
      var self = this;
      var $target = $(e.currentTarget);
      var value = $target.attr('data-value');
      var data = self.options[value];
      if (self.settings.mode === "single") {
        self.close();
      }
      // ok, google
      GooglePlacesAPI.getDetails(data)
        .done(function(placeResult) {
          var val = null;
          if (!val) {
            val = placeResult.address_components[0].long_name;
          }
          data.text = data.value = val;
          data.lng = placeResult.geometry.location.lng()
          data.lat = placeResult.geometry.location.lat()
          self.removeOption(value);
          self.addOption(data);
          $target.attr('data-value', val);
          original.call(self, e);
        })
        .fail(function(errorMsg) {
          // TODO: how to get plugin name?
          self.trigger(pluginName + ":error", errorMsg);
        });
    }
  })();
});
