#contour['nuti::contours'>0][zoom>=12][ele>0] {
	[div=10][zoom>=14],
	[div=20][zoom>=14]{
		line-color: @contour;
		line-width: 0.6;
		line-opacity:linear([view::zoom], (14, 0), (14.1, 0.3)) ;
	}
	[div=50][zoom>=13] {
		line-color: @contour;
		line-width: linear([view::zoom], (13, 0.6), (14, 1.3)) ;
		line-opacity:0.3 ;
	}
	[div=100][zoom>=12] {
		line-color: @contour;
		line-width: linear([view::zoom], (12, 0.6), (14, 1.3)) ;
		line-opacity:0.3 ;
	}
	[div=200][zoom>=12] {
		line-color: @contour;
		line-width: linear([view::zoom], (12, 0.6), (13, 1.3)) ;
		line-opacity:0.3 ;
	}
	[div=500][zoom>=12],
	[div=1000][zoom>=12] {
		line-color: @contour;
		line-width: 1.3;
		line-opacity:0.5 ;
		line-opacity:linear([view::zoom], (12, 0.5), (13, 0.5)) ;
	}
	
	[div=1000][zoom>=12],
	[div=500][zoom>=12],
	[div=200][zoom>=13],
	[div=100][zoom>=14],
	[div=50][zoom>=15] {
		text-face-name: @mont;
		text-name: [ele]+' m';
		text-fill: @contour_label;
		text-avoid-edges: false;
		text-placement: line;
		text-size: linear([view::zoom], (12, 5), (16, 8), (20, 9)) + 0.00001 * [ele];
	}
}
