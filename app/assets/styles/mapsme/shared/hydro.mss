
//river styling
#waterway{
	
	[class=stream][zoom>=13],
	[class=riverbank][zoom>=13]{
		line-cap: round;
		line-color: @river;
		line-width: linear([view::zoom], (8, 0.5), (15, 1), (16, 2));
		// line-dasharray: 7, 5;
	}
	// [class=river],
	// [class=dock],
	// [class=riverbank],
	// [class=canal][zoom>=12]{
	// 	polygon-fill: @water;
	// }
	[class=river],
	[class=riverbank] {
		line-cap: round;
		line-color: @river;
		line-width: 1;
	}
	[class=stream][zoom>=13],
	[class=canal][zoom>=13]{
		line-cap: round;
		line-color: @river;
		line-width: linear([view::zoom], (13, 0.7), (14, 1), (15, 1.6));
	}
	[class=dam][zoom>=15],
	[class=weir][zoom>=15]{
		line-cap: round;
		line-color: @bridge_casing;
		line-width: 1;
	}
	[class=lock][zoom>=16]{
		line-cap: round;
		line-color: @river;
		line-width: 1.5;
	}
	[class=ditch][zoom>=17],
	[class=drain][zoom>=17]{
		line-cap: round;
		line-color: @river;
		line-width: 1.8;
		line-dasharray: 0.9, 0.9;
	}
	
}
#water {
	[class=ocean]{
		::shadow {
			polygon-fill: darken(@water, 0.3);
			polygon-geometry-transform: translate(0,1);
			[zoom>=14] {
				polygon-geometry-transform: translate(0,2);
			}
		}
		::fill {
			polygon-fill: @water;
		}
	}
	
	[class=lake],
	[class=pond],
	[class=water],
	[class=river][zoom>=8]{
		polygon-fill: @water;
		[class=river]{
			line-color: @river;
			line-width:1;
		}
	}
}
