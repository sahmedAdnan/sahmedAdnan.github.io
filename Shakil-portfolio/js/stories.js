/* =============================================================
   Hand-written context for each work, keyed by DOI (lowercase).
   Anything not listed here is still shown, using the opening of
   its abstract, so a new paper never needs an edit to appear.
   date: when the records give only a year, the real date, so the
   works keep their order in the list and in the co-author graph.
   ============================================================= */
window.SA = window.SA || {};

SA.stories = {
  '10.64898/2026.10.15.759340': {
    short: 'Clustering and zero-shot labelling',
    venue: 'bioRxiv',
    figure: 'assets/opt/pub-framework.webp',
    alt: 'Framework overview: images and a list of candidate species pass through image and text encoders, the image features are reduced and clustered, clusters are named zero-shot, and an uncertainty score sorts the images into confidence tiers for expert review',
    story: 'Camera traps and other automatic monitors now take far more pictures of insects and birds than experts can identify by hand. We built a way to sort these pictures without training a new model. We use a pretrained foundation model to group similar pictures and to suggest a species name for each one, chosen from the species expected in the collection. Each picture also gets a score for how certain the result is, so experts only need to check the uncertain ones. We tested it on four bird and moth datasets.',
  },
  '10.1109/asiancomnet63184.2024.10811091': {
    short: 'Choosing an ISP',
    venue: 'ASIANComNet 2024, Bangkok · IEEE',
    figure: 'assets/opt/pub-multicriteria.webp',
    alt: 'Method overview: data acquisition, cleaning, calibrated random forest, feature importance and decision analysis',
    story: 'Internet providers compete on advertised speeds and prices, but customers judge them on what happens after they sign up. With Md. Mazid-Ul-Haque and colleagues I built a selection method from user survey data: a calibrated random forest that weighs cost, how well devices connect, and the experience of technical support. The model ties satisfaction closely to support quality, which advertisements rarely mention.',
  },
  '10.3390/app12010317': {
    short: 'Att-BiL-SL',
    venue: 'Applied Sciences 12(1) · MDPI',
    note: 'MSc thesis, AIUB',
    figure: 'assets/opt/pub-attbil.webp',
    alt: 'Architecture: video frames, CNN features, attention Bi-LSTM encoder and LSTM decoder producing “a person is playing guitar”',
    story: 'An encoder–decoder that watches a video and writes a sentence about it. Two attention-based Bi-LSTM layers encode the temporal features of the frames, a sequential LSTM generates the words, and soft attention with beam search chooses each one. It performed better than several existing video captioning models.',
  },
  '10.1109/icetce48199.2020.9091752': {
    short: 'Underwater tracking',
    venue: 'ICETCE 2020, Jaipur · IEEE',
    note: 'BSc thesis, AIUB',
    figure: 'assets/opt/pub-underwater.webp',
    alt: 'Segmentation of objects in clear and turbid water: camera view, colour-isolated view and binary mask',
    story: 'We recorded objects in clear, turbid and bubbling water and studied how colour-based detection and tracking behave in each, using HSV segmentation in OpenCV, to see how a simple pipeline copes as visibility drops.',
  },
  '10.14569/ijacsa.2020.0111188': {
    short: 'Anti-Molestation',
    date: '2020-11-01',   // the records give only the year; volume 11, issue 11 is the November 2020 issue
    venue: 'IJACSA 11(11)',
    figure: 'assets/opt/pub-antimol.webp',
    alt: 'Prototype hardware: Arduino Pro Mini, SIM800L GSM module, microphone, speaker, battery and panic button',
    story: 'Harassment of women and children in public places has been rising in Bangladesh, and many cases go unpunished for lack of evidence. With Md. Imtiaz Hanif I designed a pocket-sized device around an Arduino Pro Mini and a GSM module: one button dials 999, the national emergency number in Bangladesh, and sends the location to the police and to relatives by SMS.',
  },
  '10.5281/zenodo.23319152': {
    short: 'DK-Moth',
    venue: 'Zenodo',
    plate: 'specimens',
    alt: 'Seven moth species from the DK-Moth class list, drawn in their natural colours',
    story: 'A camera-trap image dataset of Danish moths, labelled to species, that we used to test a framework for clustering and zero-shot labelling of ecological images with foundation models. It covers 248 species, with balanced subsamples drawn under ten random seeds.',
  },
};
