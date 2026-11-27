#import "MPVPlayer.h"
#import <QuartzCore/CAMetalLayer.h>
@import Libmpv;
@import AVKit;
@import AVFoundation;
#import "LampyrisTV-Swift.h"
#import "PlaybackURL.h"

static NSString *Clock(double seconds) {
    NSInteger t = MAX(0, (NSInteger)seconds);
    if (t < 3600) return [NSString stringWithFormat:@"%ld:%02ld", (long)t/60, (long)t%60];
    return [NSString stringWithFormat:@"%ld:%02ld:%02ld", (long)t/3600, (long)t/60%60, (long)t%60];
}

static UILabel *Label(CGFloat size) {
    UILabel *label = [UILabel new];
    label.textColor = UIColor.whiteColor;
    label.font = [UIFont systemFontOfSize:size weight:UIFontWeightMedium];
    return label;
}

static UIButton *Button(NSString *title, id target, SEL action) {
    UIButton *button = [UIButton buttonWithType:UIButtonTypeSystem];
    [button setTitle:title forState:UIControlStateNormal];
    button.titleLabel.font = [UIFont systemFontOfSize:26 weight:UIFontWeightSemibold];
    [button addTarget:target action:action forControlEvents:UIControlEventPrimaryActionTriggered];
    return button;
}

static UIButton *TransportButton(NSString *label, NSString *symbol, id target, SEL action) {
    UIButtonConfiguration *config;
    if (@available(tvOS 26.0, *)) config = [UIButtonConfiguration glassButtonConfiguration];
    else config = [UIButtonConfiguration tintedButtonConfiguration];
    config.contentInsets = NSDirectionalEdgeInsetsZero;
    config.cornerStyle = UIButtonConfigurationCornerStyleCapsule;
    config.baseForegroundColor = UIColor.whiteColor;
    UIButton *button = [UIButton buttonWithConfiguration:config primaryAction:nil];
    [button addTarget:target action:action forControlEvents:UIControlEventPrimaryActionTriggered];
    UIImageSymbolConfiguration *size = [UIImageSymbolConfiguration configurationWithPointSize:27 weight:UIImageSymbolWeightSemibold];
    [button setImage:[UIImage systemImageNamed:symbol withConfiguration:size] forState:UIControlStateNormal];
    button.accessibilityLabel = label;
    return button;
}

@interface MPVPlayer () <UIGestureRecognizerDelegate>
@property (nonatomic, copy) NSArray<NSDictionary *> *items;
@property (nonatomic) NSUInteger itemIndex;
@property (nonatomic) NSInteger scanRate;
@property (nonatomic) double reverseOrigin, reverseStart, lastReverseSeek;
@property (nonatomic, copy) NSString *resumeKey, *activeSegmentKind;
@property (nonatomic, strong) UIView *panel, *rail, *buffer, *progress, *sheet;
@property (nonatomic, strong) CAGradientLayer *shade;
@property (nonatomic, strong) UIView *playhead;
@property (nonatomic, strong) UILabel *heading, *elapsed, *remaining, *preview, *info;
@property (nonatomic, strong) UIButton *timeline, *playlistButton, *pauseButton, *nextButton, *introButton;
@property (nonatomic, strong) UIStackView *actions, *options;
@property (nonatomic, strong) UIScrollView *scroll;
@property (nonatomic, weak) UIView *preferred;
@property (nonatomic, copy) NSArray<NSNumber *> *chapters;
@property (nonatomic, strong) NSMutableArray<UIView *> *markers;
@property (nonatomic) double duration, position, introEnd, pendingSeek, sleepDeadline, lastSave, lastInteraction;
@property (nonatomic) BOOL loaded, waitingForResume, ownsIdleTimer, reportedSave;
@property (nonatomic) double resumeTime, panStart, resumeDeadline;
@property (nonatomic, copy) NSString *page;
@property (nonatomic, strong) UIView *cover;
@property (nonatomic, strong) UIImageView *coverImage;
@property (nonatomic, strong) UILabel *coverTitle;
@property (nonatomic, strong) NSURLSessionTask *artTask;
@property (nonatomic, strong) UIButton *chaptersButton;
@property (nonatomic, weak) UIView *sheetOpener;
@property (nonatomic, copy) NSArray *skipSegments;
@property (nonatomic, strong) NSMutableArray<NSURL *> *subtitleFiles;
@property (nonatomic, copy) NSString *displaySignature;
@property (nonatomic) NSUInteger generation;
@property (nonatomic) BOOL resolving;
@property (nonatomic) double nextStatsPoll;
@property (nonatomic, copy) NSString *liveStats;
@property (nonatomic, strong) CAMetalLayer *surface;
@property (nonatomic, strong) UILabel *status;
@property (nonatomic, strong) NSTimer *timer;
@end

@implementation MPVPlayer {
    mpv_handle *_player;
}

- (instancetype)initWithItems:(NSArray<NSDictionary *> *)items {
    if ((self = [super init])) {
        self.items = items;
        NSUInteger selected = [items indexOfObjectPassingTest:^BOOL(NSDictionary *item, NSUInteger index, BOOL *stop){
            return [item[@"selected"] boolValue];
        }];
        self.itemIndex = selected == NSNotFound ? 0 : selected;
        self.subtitleFiles = [NSMutableArray array];
        self.pendingSeek = -1;
        self.modalPresentationStyle = UIModalPresentationFullScreen;
    }
    return self;
}

- (void)viewDidLoad {
    [super viewDidLoad];
    self.view.backgroundColor = UIColor.blackColor;
    self.surface = [CAMetalLayer layer];
    self.surface.frame = self.view.bounds;
    [self.view.layer addSublayer:self.surface];
    self.cover = [[UIView alloc] initWithFrame:self.view.bounds];
    self.cover.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
    self.cover.backgroundColor = [UIColor colorWithWhite:0.08 alpha:1];
    self.cover.userInteractionEnabled = NO;
    self.coverImage = [[UIImageView alloc] initWithFrame:self.cover.bounds];
    self.coverImage.autoresizingMask = self.cover.autoresizingMask;
    self.coverImage.contentMode = UIViewContentModeScaleAspectFill;
    self.coverImage.clipsToBounds = YES;
    self.coverImage.alpha = 0.58;
    [self.cover addSubview:self.coverImage];
    self.coverTitle = Label(58);
    self.coverTitle.numberOfLines = 2;
    self.coverTitle.textAlignment = NSTextAlignmentCenter;
    [self.cover addSubview:self.coverTitle];
    [self.view addSubview:self.cover];
    self.status = [UILabel new];
    self.status.textColor = UIColor.whiteColor;
    self.status.textAlignment = NSTextAlignmentCenter;
    self.status.numberOfLines = 0;
    self.status.text = @"Загрузка видео…";
    [self.view addSubview:self.status];
    [self makePanel];
    [self showCover];
    for (NSNumber *key in @[@(UIPressTypeSelect), @(UIPressTypePlayPause), @(UIPressTypeLeftArrow),
                              @(UIPressTypeRightArrow), @(UIPressTypeUpArrow), @(UIPressTypeDownArrow), @(UIPressTypeMenu)]) {
        UITapGestureRecognizer *tap = [[UITapGestureRecognizer alloc] initWithTarget:self action:@selector(remote:)];
        tap.delegate = self;
        tap.allowedPressTypes = @[key];
        tap.allowedTouchTypes = @[];
        [self.view addGestureRecognizer:tap];
    }
    UIPanGestureRecognizer *pan = [[UIPanGestureRecognizer alloc] initWithTarget:self action:@selector(scrub:)];
    pan.allowedTouchTypes = @[@(UITouchTypeIndirect)];
    pan.delegate = self;
    [self.view addGestureRecognizer:pan];
    [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(background:)
        name:UIApplicationDidEnterBackgroundNotification object:nil];
}

- (void)viewDidLayoutSubviews {
    [super viewDidLayoutSubviews];
    self.surface.frame = self.view.bounds;
    self.surface.contentsScale = self.view.window.screen.scale ?: 1;
    CGRect safe = self.view.safeAreaLayoutGuide.layoutFrame;
    self.status.frame = self.cover.hidden ? safe : CGRectMake(CGRectGetMinX(safe), CGRectGetMidY(safe)+48, safe.size.width, 60);
    self.coverTitle.frame = CGRectMake(CGRectGetMinX(safe)+40, CGRectGetMidY(safe)-120, safe.size.width-80, 155);
    CGFloat left = CGRectGetMinX(safe), width = safe.size.width;
    CGFloat bottom = CGRectGetMaxY(safe);
    self.panel.frame = CGRectMake(0, bottom-208, self.view.bounds.size.width, CGRectGetMaxY(self.view.bounds)-bottom+208);
    self.shade.frame = self.panel.bounds;
    NSUInteger count = 0;
    for (UIView *v in self.actions.arrangedSubviews) if (!v.hidden) count++;
    CGFloat controlsWidth = count*64 + (count-1)*12;
    self.actions.frame = CGRectMake(left+width-controlsWidth, 76, controlsWidth, 54);
    self.heading.frame = CGRectMake(left, 70, width-controlsWidth-40, 68);
    self.timeline.frame = CGRectMake(left, 137, width, 42);
    self.rail.frame = CGRectMake(left+8, 155, width-16, 6);
    self.elapsed.frame = CGRectMake(left, 172, 350, 32);
    self.remaining.frame = CGRectMake(left+width-170, 172, 170, 32);
    self.introButton.frame = CGRectMake(CGRectGetMaxX(safe)-380, CGRectGetMinY(self.panel.frame)-80, 380, 64);
    CGFloat sheetWidth = self.info ? MIN(800, width*0.54) : MIN(620, width*0.44);
    CGFloat sheetHeight = MIN(safe.size.height-48, MAX(190, 110+self.options.arrangedSubviews.count*76));
    if (self.info) sheetHeight = safe.size.height - 40;
    self.sheet.frame = CGRectMake(CGRectGetMaxX(safe)-sheetWidth, CGRectGetMinY(safe)+20, sheetWidth, sheetHeight);
    self.scroll.frame = CGRectInset(self.sheet.bounds, 28, 24);
    self.preview.frame = CGRectMake(left, CGRectGetMidY(safe), MAX(250,width-sheetWidth-60), 100);
    [self updateRail];
}

- (void)viewDidAppear:(BOOL)animated {
    [super viewDidAppear:animated];
    [self startPlayback];
}

- (void)startPlayback {
    if (_player) return;
    _player = mpv_create();
    int64_t layer = (intptr_t)(__bridge void *)self.surface;
    if (!_player || mpv_set_option(_player, "wid", MPV_FORMAT_INT64, &layer) < 0 ||
        mpv_set_option_string(_player, "vo", "gpu-next") < 0 ||
        mpv_set_option_string(_player, "gpu-api", "vulkan") < 0 ||
        mpv_set_option_string(_player, "gpu-context", "moltenvk") < 0) {
        [self playbackFailed];
        return;
    }
    mpv_set_option_string(_player, "hwdec", "auto-safe");
    mpv_set_option_string(_player, "target-colorspace-hint", "yes");
    mpv_set_option_string(_player, "terminal", "no");
    mpv_set_option_string(_player, "ytdl", "no");
    if (mpv_initialize(_player) < 0) {
        [self playbackFailed];
        return;
    }
    [self loadItem];
    if (!_player) return;
    __weak MPVPlayer *weakSelf = self;
    self.timer = [NSTimer scheduledTimerWithTimeInterval:0.15 repeats:YES block:^(NSTimer *timer) {
        [weakSelf processEvents];
    }];
}

- (void)processEvents {
    mpv_event *event;
    while (_player && (event = mpv_wait_event(_player, 0))->event_id != MPV_EVENT_NONE) {
        if (self.resolving) continue;
        if (event->event_id == MPV_EVENT_FILE_LOADED) {
            self.loaded = YES;
            self.lastInteraction = NSProcessInfo.processInfo.systemUptime;
            [self refreshChapters];
            [self prepareSegments];
            [self restoreTracks];
            [self applyAudio];

        }
        if (event->event_id == MPV_EVENT_VIDEO_RECONFIG || event->event_id == MPV_EVENT_PLAYBACK_RESTART) {
            [self matchDisplay];
            if (event->event_id == MPV_EVENT_PLAYBACK_RESTART && self.loaded) {
                self.cover.hidden = YES;
                [self.artTask cancel];
                self.status.text = nil;
                [self.view setNeedsLayout];
            }
        }
        if (event->event_id == MPV_EVENT_COMMAND_REPLY && event->error < 0 && event->reply_userdata == 1) {
            [self playbackFailedWithCode:event->error];
            return;
        }
        if (event->event_id == MPV_EVENT_END_FILE) {
            mpv_event_end_file *end = event->data;
            if (end->reason == MPV_END_FILE_REASON_ERROR) {
                [self playbackFailedWithCode:end->error];
                return;
            }
            else if (end->reason == MPV_END_FILE_REASON_EOF) {
                [self completeCurrentItem];
                if ([self.media[@"series"] boolValue] && self.itemIndex + 1 < self.items.count) {
                    if (self.sheet) [self closeSheet];
                    [self nextItem];
                } else {
                    [self dismissViewControllerAnimated:YES completion:nil];
                }
                return;
            }
        }
    }
    if (_player) [self refresh];
}

- (void)playbackFailed {
    [self playbackFailedWithCode:0];
}

- (void)playbackFailedWithCode:(int)code {
    [self savePosition];
    self.cover.hidden = YES;
    self.loaded = NO;
    self.panel.hidden = YES;
    self.introButton.hidden = YES;
    self.status.text = code < 0 ? [NSString stringWithFormat:@"Ошибка mpv (%s). Нажмите «Назад».", mpv_error_string(code)] : @"Не удалось запустить mpv. Нажмите «Назад».";
    [self stopPlayback];
    [self beginSheet:@"Ошибка воспроизведения"];
    [self option:@"Повторить с места остановки" action:^(MPVPlayer *p){
        [p closeSheet]; [p startPlayback];
    }];
    [self option:@"Вернуться в каталог" action:^(MPVPlayer *p){ [p dismissViewControllerAnimated:YES completion:nil]; }];
    [self finishSheet];
}

- (void)keepScreenAwake:(BOOL)awake {
    UIApplication *app = UIApplication.sharedApplication;
    if (awake && !app.idleTimerDisabled) {
        app.idleTimerDisabled = YES;
        self.ownsIdleTimer = YES;
    } else if (!awake && self.ownsIdleTimer) {
        app.idleTimerDisabled = NO;
        self.ownsIdleTimer = NO;
    }
}

- (void)background:(NSNotification *)notification {
    [self endScan];
    [self savePosition];
    if (_player) mpv_set_property_string(_player, "pause", "yes");
    [self keepScreenAwake:NO];
}

- (double)number:(const char *)key {
    double value = 0;
    if (_player) mpv_get_property(_player, key, MPV_FORMAT_DOUBLE, &value);
    return isfinite(value) ? value : 0;
}

- (BOOL)seekable {
    int flag = 0;
    return _player && mpv_get_property(_player, "seekable", MPV_FORMAT_FLAG, &flag) >= 0 && flag;
}

- (NSString *)string:(NSString *)key {
    char *value = _player ? mpv_get_property_string(_player, key.UTF8String) : NULL;
    if (!value) return @"";
    NSString *result = [NSString stringWithUTF8String:value];
    mpv_free(value);
    return result ?: @"";
}

- (void)set:(NSString *)key value:(NSString *)value {
    if (_player) mpv_set_property_string(_player, key.UTF8String, value.UTF8String);
}

- (void)seek:(double)time {
    if (!_player || !self.loaded) return;
    double dest = MAX(0,time);
    NSString *seconds = @(dest).stringValue;
    const char *args[] = {"seek", seconds.UTF8String, "absolute+exact", NULL};
    mpv_command_async(_player, 0, args);
}

- (void)showCover {
    NSDictionary *item = self.items[self.itemIndex];
    self.coverTitle.text = [item[@"coverTitle"] length] ? item[@"coverTitle"] : (item[@"title"] ?: [item[@"url"] lastPathComponent]);
    self.cover.hidden = NO;
    self.coverImage.image = nil;
    [self.artTask cancel];
    NSURL *art = item[@"artwork"];
    if ([art isKindOfClass:NSURL.class]) {
        __weak MPVPlayer *owner = self;
        self.artTask = [PlayerServices artwork:art completion:^(NSData *data){
            MPVPlayer *p = owner;
            if (data && p.items[p.itemIndex] == item && !p.cover.hidden) p.coverImage.image = [UIImage imageWithData:data];
        }];
    }
}

- (void)loadItem {
    [self endScan];
    if (self.generation > 0) [self showCover];
    self.generation++;
    self.nextStatsPoll = 0;
    self.liveStats = nil;
    self.resolving = NO;
    self.skipSegments = nil;
    NSDictionary *item = self.items[self.itemIndex];
    NSURL *url = item[@"url"];
    NSString *legacy = ResumeKey(url);
    NSString *identifier = item[@"resumeID"];
    self.resumeKey = identifier.length ? [@"mpv.content." stringByAppendingString:identifier] : legacy;
    NSUserDefaults *defaults = NSUserDefaults.standardUserDefaults;
    id saved = [defaults objectForKey:self.resumeKey];
    if (!saved && ![self.resumeKey isEqual:legacy]) {
        saved = [defaults objectForKey:legacy];
        if (saved) {
            [defaults setObject:saved forKey:self.resumeKey];
            [defaults removeObjectForKey:legacy];
        }
    }
    NSNumber *localTime = [saved isKindOfClass:NSDictionary.class] ? saved[@"time"] : saved;
    double localUpdated = [saved isKindOfClass:NSDictionary.class] ? [saved[@"updated"] doubleValue] : 0;
    self.reportedSave = NO;
    self.resumeTime = !localTime || [item[@"resumeUpdated"] doubleValue] > localUpdated
        ? [item[@"resume"] doubleValue] : localTime.doubleValue;
    self.waitingForResume = NO;
    self.lastSave = NSProcessInfo.processInfo.systemUptime;
    self.loaded = NO;
    self.duration = self.position = 0;
    self.pendingSeek = -1;
    self.status.text = @"Загрузка видео…";
    self.heading.text = [item[@"title"] isKindOfClass:NSString.class] && [item[@"title"] length] ? item[@"title"] : url.lastPathComponent;
    self.chaptersButton.hidden = YES;
    self.nextButton.hidden = self.itemIndex+1 >= self.items.count;
    [self.view setNeedsLayout];
    self.introButton.hidden = YES;
    self.introEnd = 0;
    NSString *key = self.media[@"torBoxKey"];
    if (key.length && (self.generation > 1 || ![item[@"selected"] boolValue])) {
        self.resolving = YES;
        const char *stop[] = {"stop", NULL};
        mpv_command(_player, stop);
        NSUInteger generation = self.generation;
        self.webRequest(NO, key, ^(NSString *value) {
            if (generation != self.generation || !self->_player) return;
            [self processEvents];
            self.resolving = NO;
            NSURL *fresh = value.length ? [NSURL URLWithString:value] : nil;
            if (fresh.host && [@[@"https", @"http"] containsObject:fresh.scheme.lowercaseString]) [self loadURL:fresh];
            else [self playbackFailed];
        });
        return;
    }
    [self loadURL:url];
}

- (void)loadURL:(NSURL *)url {
    [self set:@"pause" value:@"no"];
    const char *cmd[] = {"loadfile",url.absoluteString.UTF8String,"replace",NULL};
    if (mpv_command_async(_player,1,cmd)<0) [self playbackFailed];
}

- (void)savePosition {
    if (!self.loaded || self.duration <= 0 || self.resumeTime > 0 || self.waitingForResume) return;
    double pos = [self number:"time-pos"];
    if (pos <= 0) return;
    [NSUserDefaults.standardUserDefaults setObject:@{@"time":@(pos), @"updated":@(NSDate.date.timeIntervalSince1970 * 1000)} forKey:self.resumeKey];
    if (!self.reportedSave) {
        NSLog(@"Lampyris mpv stored first playback position");
        self.reportedSave = YES;
    }
    NSString *token = self.items[self.itemIndex][@"token"];
    if (token && self.progressHandler) self.progressHandler(token, pos, self.duration);
}

- (void)makePanel {
    self.panel = [UIView new];
    self.shade = [CAGradientLayer layer];
    self.shade.colors = @[(id)[UIColor colorWithWhite:0 alpha:0].CGColor,
        (id)[UIColor colorWithWhite:0 alpha:0.70].CGColor, (id)[UIColor colorWithWhite:0 alpha:0.94].CGColor];
    self.shade.locations = @[@0,@0.46,@1];
    [self.panel.layer addSublayer:self.shade];
    [self.view addSubview:self.panel];
    self.heading = Label(42);
    self.heading.font = [UIFont systemFontOfSize:42 weight:UIFontWeightBold];
    self.elapsed = Label(26);
    self.remaining = Label(26);
    self.elapsed.font = self.remaining.font = [UIFont monospacedDigitSystemFontOfSize:24 weight:UIFontWeightMedium];
    self.remaining.textAlignment = NSTextAlignmentRight;
    self.timeline = [UIButton buttonWithType:UIButtonTypeCustom];
    [self.timeline addTarget:self action:@selector(confirmSeek) forControlEvents:UIControlEventPrimaryActionTriggered];
    self.timeline.accessibilityLabel = @"Шкала просмотра";
    self.rail = [UIView new];
    self.rail.userInteractionEnabled = NO;
    self.rail.backgroundColor = [UIColor colorWithWhite:1 alpha:0.24];
    self.rail.layer.cornerRadius = 3;
    self.rail.clipsToBounds = YES;
    self.buffer = [UIView new];
    self.buffer.backgroundColor = [UIColor colorWithWhite:1 alpha:0.4];
    self.progress = [UIView new];
    self.progress.backgroundColor = [UIColor colorWithRed:1 green:0.72 blue:0.22 alpha:1];
    self.playhead = [UIView new];
    self.playhead.backgroundColor = UIColor.whiteColor;
    self.playhead.userInteractionEnabled = NO;
    [self.rail addSubview:self.buffer];
    [self.rail addSubview:self.progress];
    self.markers = [NSMutableArray array];
    self.actions = [[UIStackView alloc] initWithFrame:CGRectMake(0, 0, 520, 54)];
    self.actions.spacing = 12;
    self.actions.distribution = UIStackViewDistributionFillEqually;
    self.pauseButton = TransportButton(@"Пауза",@"pause.fill",self,@selector(togglePause));
    self.chaptersButton = TransportButton(@"Главы",@"bookmark",self,@selector(chapterMenu));
    self.chaptersButton.hidden = YES;
    self.playlistButton = TransportButton(@"Серии / плейлист",@"list.bullet",self,@selector(playlist));
    self.playlistButton.hidden = self.items.count < 2;
    self.nextButton = TransportButton(@"Следующая серия",@"forward.end.fill",self,@selector(nextItem));
    for (UIButton *b in @[TransportButton(@"Назад на 10 секунд",@"gobackward.10",self,@selector(backTen)),
            self.pauseButton, TransportButton(@"Вперёд на 10 секунд",@"goforward.10",self,@selector(forwardTen)),
            TransportButton(@"Звук",@"speaker.wave.2.fill",self,@selector(audio)),
            TransportButton(@"Субтитры",@"captions.bubble",self,@selector(subs)),
            TransportButton(@"Картинка",@"slider.horizontal.3",self,@selector(picture)),
            TransportButton(@"Скорость",@"speedometer",self,@selector(speedMenu)),
            TransportButton(@"Формат изображения",@"aspectratio",self,@selector(aspectMenu)),
            TransportButton(@"Пропуск и переход",@"forward.end",self,@selector(skipMenu)),
            self.chaptersButton, TransportButton(@"Таймер сна",@"moon",self,@selector(sleepMenu)),
            TransportButton(@"Информация о файле",@"info.circle",self,@selector(fileInfo)),self.playlistButton,self.nextButton])
        [self.actions addArrangedSubview:b];
    for (UIView *v in @[self.heading,self.elapsed,self.remaining,self.timeline,self.rail,self.playhead,self.actions]) [self.panel addSubview:v];
    self.introButton = Button(@"Пропустить",self,@selector(skipIntro));
    self.introButton.hidden = YES;
    [self.view addSubview:self.introButton];
    self.preferred = self.pauseButton;
}

- (NSArray<id<UIFocusEnvironment>> *)preferredFocusEnvironments {
    return self.preferred && !self.preferred.hidden ? @[self.preferred] : [super preferredFocusEnvironments];
}

- (void)focus:(UIView *)target {
    self.preferred = target;
    [self setNeedsFocusUpdate];
    [self updateFocusIfNeeded];
}

- (void)refreshChapters {
    for (UIView *marker in self.markers) [marker removeFromSuperview];
    [self.markers removeAllObjects];
    NSMutableArray *times = [NSMutableArray array];
    NSInteger count = [self number:"chapters"];
    for (NSInteger i=0;i<count;i++) {
        NSString *path = [NSString stringWithFormat:@"chapter-list/%ld/time",(long)i];
        [times addObject:@([self number:path.UTF8String])];
        UIView *marker = [UIView new];
        marker.backgroundColor = UIColor.whiteColor;
        [self.rail addSubview:marker];
        [self.markers addObject:marker];
    }
    self.chapters = times;
    self.chaptersButton.hidden = !times.count;
    [self.view setNeedsLayout];
}

- (void)updateRail {
    double duration = self.duration;
    CGFloat width = self.rail.bounds.size.width, height = self.rail.bounds.size.height;
    double pos = self.pendingSeek >= 0 ? self.pendingSeek : self.position;
    double cache = self.loaded ? [self number:"demuxer-cache-duration"] : 0;
    self.buffer.frame = CGRectMake(0,0,duration>0 ? width*MIN(1,(self.position+cache)/duration) : 0,height);
    self.progress.frame = CGRectMake(0,0,duration>0 ? width*MIN(1,pos/duration) : 0,height);
    CGFloat diameter = self.timeline.focused ? 20 : 12;
    CGFloat xPos = CGRectGetMinX(self.rail.frame) + self.progress.frame.size.width;
    self.playhead.frame = CGRectMake(xPos-diameter/2, CGRectGetMidY(self.rail.frame)-diameter/2, diameter, diameter);
    self.playhead.layer.cornerRadius = diameter/2;
    for (NSUInteger i=0;i<self.markers.count;i++) {
        CGFloat x = duration>0 ? width*self.chapters[i].doubleValue/duration : 0;
        self.markers[i].frame = CGRectMake(x,0,2,height);
    }
}

- (void)refresh {
    double now = NSProcessInfo.processInfo.systemUptime;
    if (self.sleepDeadline && now >= self.sleepDeadline) {
        self.sleepDeadline = 0;
        [self endScan];
        [self set:@"pause" value:@"yes"];
        self.panel.hidden = NO;
        [self focus:self.pauseButton];
    }
    if (!self.loaded) return;
    int buffering = 0, paused = 0;
    mpv_get_property(_player, "paused-for-cache", MPV_FORMAT_FLAG, &buffering);
    mpv_get_property(_player, "pause", MPV_FORMAT_FLAG, &paused);
    [self keepScreenAwake:!paused && UIApplication.sharedApplication.applicationState == UIApplicationStateActive];
    self.status.text = buffering ? @"Буферизация…" : self.cover.hidden ? nil : @"Загрузка видео…";
    self.position = [self number:"time-pos"];
    self.duration = [self number:"duration"];
    if (self.resumeTime > 0 && self.duration > 0 && !self.waitingForResume) {
        if (self.resumeTime < self.duration - 1 && [self seekable]) {
            [self seek:self.resumeTime];
            self.waitingForResume = YES;
            self.resumeDeadline = now + 10;
        } else if ([self seekable]) self.resumeTime = 0;
    }
    if (self.waitingForResume && (fabs(self.position-self.resumeTime) < 3 || now > self.resumeDeadline)) {
        self.resumeTime = 0;
        self.waitingForResume = NO;
    }
    if (self.scanRate < 0 && now - self.lastReverseSeek >= 0.4) {
        double target = MAX(0, self.reverseOrigin + self.scanRate * (now - self.reverseStart));
        [self seek:target];
        self.lastReverseSeek = now;
        if (target == 0) [self endScan];
    }
    if (now-self.lastSave >= 5) {
        [self savePosition];
        self.lastSave = now;
    }
    self.introEnd = 0;
    self.activeSegmentKind = nil;
    for (id seg in self.skipSegments) {
        if (![seg isKindOfClass:NSDictionary.class] || ![seg[@"end"] respondsToSelector:@selector(doubleValue)]) continue;
        double start = [seg[@"start"] respondsToSelector:@selector(doubleValue)] ? [seg[@"start"] doubleValue] : 0;
        double end = [seg[@"end"] doubleValue];
        if (end == -1) end = self.duration;
        if (self.position < start || self.position >= end) continue;
        NSString *kind = [seg[@"kind"] isKindOfClass:NSString.class] ? seg[@"kind"] : nil;
        if (self.introEnd > 0 && !kind.length) continue;
        self.activeSegmentKind = kind;
        self.introEnd = end;
        if (kind.length) break;
    }
    if (self.introEnd > 0) {
        NSString *label = @{@"intro":@"Пропустить заставку", @"recap":@"Пропустить пересказ",
                            @"preview":@"Пропустить анонс", @"credits":@"Пропустить титры"}[self.activeSegmentKind ?: @""] ?: @"Пропустить";
        if ([self canAdvanceAtCredits]) label = @"Следующая серия";
        if (![self.introButton.currentTitle isEqual:label]) [self.introButton setTitle:label forState:UIControlStateNormal];
    }
    BOOL wasHidden = self.introButton.hidden;
    self.introButton.hidden = self.introEnd<=0 || self.sheet;
    if (wasHidden && !self.introButton.hidden && self.panel.hidden) [self focus:self.introButton];
    if (!self.sheet && !self.panel.hidden && self.pendingSeek<0 && !self.scanRate && now-self.lastInteraction>8 &&
        [[self string:@"pause"] isEqual:@"no"]) {
        self.panel.hidden = YES;
        [self focus:self.introButton.hidden ? nil : self.introButton];
    }
    if (self.panel.hidden && !self.sheet) return;
    double pos = self.pendingSeek>=0 ? self.pendingSeek : self.position;
    self.elapsed.text = self.scanRate ? [NSString stringWithFormat:@"%@   %@%ld×", Clock(pos),
        self.scanRate < 0 ? @"◀" : @"▶", (long)labs(self.scanRate)] : Clock(pos);
    self.timeline.accessibilityValue = self.elapsed.text;
    self.remaining.text = self.duration>0 ? [@"−" stringByAppendingString:Clock(self.duration-pos)] : @"Эфир";
    NSString *pause = [[self string:@"pause"] isEqual:@"yes"] ? @"Продолжить" : @"Пауза";
    if (![self.pauseButton.accessibilityLabel isEqual:pause]) {
        self.pauseButton.accessibilityLabel = pause;
        NSString *symbol = [pause isEqual:@"Пауза"] ? @"pause.fill" : @"play.fill";
        [self.pauseButton setImage:[UIImage systemImageNamed:symbol withConfiguration:self.pauseButton.currentImage.symbolConfiguration] forState:UIControlStateNormal];
    }
    [self updateRail];
    NSString *address = self.media[@"statsAddress"];
    if (self.info && address.length && now >= self.nextStatsPoll) {
        self.nextStatsPoll = DBL_MAX;
        NSUInteger generation = self.generation;
        self.webRequest(YES, address, ^(NSString *value) {
            if (generation != self.generation) return;
            self.liveStats = value;
            self.nextStatsPoll = NSProcessInfo.processInfo.systemUptime + 3;
        });
    }
    if (self.info) self.info.text = [NSString stringWithFormat:@"%@ × %@   ·   %.2f кадр/с\nВидео   %@\nАудио   %@\nСеть   %.2f Мбит/с\nБуфер   %.1f с\nДекодер   %@   ·   Пропуски   %.0f\nЦвет источника   %@ / %@   ·   Вывод   %@%@%@",
        [self string:@"width"],[self string:@"height"],[self number:"container-fps"],[self string:@"video-codec"],
        [self string:@"audio-codec-name"],[self number:"cache-speed"]*8/1e6,[self number:"demuxer-cache-duration"],
        [self string:@"hwdec-current"], [self number:"frame-drop-count"], [self string:@"video-params/primaries"],
        [self string:@"video-params/gamma"], [self outputColorName],
        [self.media[@"torrentDetails"] length] ? [@"\n" stringByAppendingString:self.media[@"torrentDetails"]] : @"",
        self.liveStats.length ? [@"\n" stringByAppendingString:self.liveStats] : @""];
}

- (void)backTen { [self seek:self.position-10]; }
- (void)forwardTen { [self seek:self.position+10]; }
- (void)skipMenu {
    if (self.introEnd > 0) { [self skipIntro]; return; }
    [self beginSheet:@"Пропуск и переход"];
    for (NSNumber *time in self.chapters) {
        if (time.doubleValue <= self.position) continue;
        [self option:[NSString stringWithFormat:@"До следующей главы · %@", Clock(time.doubleValue)] action:^(MPVPlayer *p){
            [p seek:time.doubleValue]; [p closeSheet];
        }];
        break;
    }
    [self option:@"Вперёд на 60 секунд" action:^(MPVPlayer *p){ [p seek:p.position+60]; [p closeSheet]; }];
    [self option:@"Закрыть" action:^(MPVPlayer *p){ [p closeSheet]; }];
    [self finishSheet];
}

- (BOOL)canAdvanceAtCredits {
    return [self.activeSegmentKind isEqual:@"credits"] && [self.media[@"series"] boolValue] && self.itemIndex + 1 < self.items.count;
}

- (void)skipIntro {
    if (self.introEnd <= 0) return;
    if ([self canAdvanceAtCredits]) {
        [self completeCurrentItem];
        [self nextItem];
    } else [self seek:self.introEnd];
}
- (void)togglePause {
    if (self.scanRate) { [self endScan]; return; }
    if (_player) [self set:@"pause" value:[[self string:@"pause"] isEqual:@"yes"] ? @"no" : @"yes"];
}
- (void)confirmSeek {
    [self endScan];
    if (self.pendingSeek>=0) {
        self.resumeTime = 0;
        self.waitingForResume = NO;
        [self seek:self.pendingSeek];
    }
    self.pendingSeek = -1;
}
- (void)playlist {
    [self beginSheet:[self.media[@"series"] boolValue] ? @"Список серий" : @"Плейлист"];
    for (NSUInteger i=0; i<self.items.count; i++) {
        NSDictionary *item = self.items[i], *media = item[@"media"];
        NSString *title = item[@"title"];
        NSString *prefix = [media[@"episode"] integerValue] > 0
            ? [NSString stringWithFormat:@"S%02ldE%02ld", (long)[media[@"season"] integerValue], (long)[media[@"episode"] integerValue]]
            : [NSString stringWithFormat:@"%lu.", (unsigned long)i+1];
        NSString *label = [NSString stringWithFormat:@"%@%@", i == self.itemIndex ? @"✓ " : @"",
            [title containsString:prefix] ? title : [NSString stringWithFormat:@"%@ %@", prefix, title ?: @""]];
        [self option:label action:^(MPVPlayer *p){
            [p closeSheet];
            if (i == p.itemIndex) return;
            [p savePosition]; p.itemIndex = i; [p loadItem];
        }];
    }
    [self finishSheet];
    [self focus:self.options.arrangedSubviews[self.itemIndex+1]];
}

- (void)completeCurrentItem {
    if (self.duration > 0 && self.progressHandler && self.items[self.itemIndex][@"token"])
        self.progressHandler(self.items[self.itemIndex][@"token"], self.duration, self.duration);
    self.loaded = NO;
    [NSUserDefaults.standardUserDefaults removeObjectForKey:self.resumeKey];
}

- (void)nextItem {
    if (self.itemIndex+1 >= self.items.count) return;
    [self savePosition];
    self.itemIndex++;
    [self loadItem];
    [self focus:self.pauseButton];
}

- (BOOL)gestureRecognizerShouldBegin:(UIGestureRecognizer *)gesture {
    if (![gesture isKindOfClass:UIPanGestureRecognizer.class]) return YES;
    CGPoint v = [(UIPanGestureRecognizer *)gesture velocityInView:self.view];
    return !self.sheet && (self.timeline.focused || self.panel.hidden) && [self seekable]
        && self.duration > 0 && fabs(v.x) > fabs(v.y);
}

- (void)scrub:(UIPanGestureRecognizer *)gesture {
    self.lastInteraction = NSProcessInfo.processInfo.systemUptime;
    if (gesture.state == UIGestureRecognizerStateBegan) {
        [self endScan];
        self.panStart = self.pendingSeek >= 0 ? self.pendingSeek : self.position;
        self.panel.hidden = NO;
        [self focus:self.timeline];
    }
    if (gesture.state == UIGestureRecognizerStateCancelled) self.pendingSeek = -1;
    else {
        CGFloat dx = [gesture translationInView:self.view].x;
        self.pendingSeek = MIN(self.duration, MAX(0, self.panStart + self.duration * dx / MAX(1,self.timeline.bounds.size.width)));
    }
    [self refresh];
}

- (void)endScan {
    if (!self.scanRate) return;
    self.scanRate = 0;
    [self set:@"speed" value:@"1"];
    [self set:@"pause" value:@"no"];
    self.lastInteraction = NSProcessInfo.processInfo.systemUptime;
}

- (void)scanOnTimeline:(UIPressType)key {
    NSInteger direction = key == UIPressTypeLeftArrow ? -1 : 1;
    NSInteger rate = self.scanRate * direction > 0 ? MIN(8, labs(self.scanRate) * 2) : 2;
    if (self.scanRate == direction * rate) return;
    double position = self.pendingSeek >= 0 ? self.pendingSeek : [self number:"time-pos"];
    [self confirmSeek];
    self.scanRate = direction * rate;
    self.resumeTime = 0;
    self.waitingForResume = NO;
    if (direction > 0) {
        [self set:@"speed" value:@(rate).stringValue];
        [self set:@"pause" value:@"no"];
    } else {
        // Decode individual frames going backwards, including on streams without a reverse decoder.
        [self set:@"pause" value:@"yes"];
        self.reverseOrigin = position;
        self.lastReverseSeek = self.reverseStart = NSProcessInfo.processInfo.systemUptime;
    }
    [self refresh];
}

- (BOOL)gestureRecognizer:(UIGestureRecognizer *)gesture shouldReceivePress:(UIPress *)press {
    self.lastInteraction = NSProcessInfo.processInfo.systemUptime;
    if (press.type == UIPressTypeMenu || press.type == UIPressTypePlayPause) return YES;
    if (self.sheet) return NO;
    if (self.panel.hidden) return !(press.type==UIPressTypeSelect && self.introButton.focused);
    return self.timeline.focused && (press.type==UIPressTypeLeftArrow || press.type==UIPressTypeRightArrow);
}

- (void)remote:(UITapGestureRecognizer *)tap {
    UIPressType key = tap.allowedPressTypes.firstObject.integerValue;
    if (key == UIPressTypeMenu) {
        if (self.sheet) {
            [self closeSheet];
        } else if (!self.panel.hidden) {
            [self endScan];
            self.pendingSeek = -1;
            self.panel.hidden = YES;
            [self focus:self.introButton.hidden ? nil : self.introButton];
        } else [self dismissViewControllerAnimated:YES completion:nil];
    } else if (key == UIPressTypePlayPause) [self togglePause];
    else if (self.panel.hidden && _player) {
        self.panel.hidden = NO;
        if ((key == UIPressTypeLeftArrow || key == UIPressTypeRightArrow) && self.duration > 0 && [self seekable]) {
            [self focus:self.timeline];
            [self scanOnTimeline:key];
        } else [self focus:self.pauseButton];
    } else if (self.timeline.focused && self.duration > 0 && [self seekable]) {
        [self scanOnTimeline:key];
    }
}

- (void)didUpdateFocusInContext:(UIFocusUpdateContext *)context withAnimationCoordinator:(UIFocusAnimationCoordinator *)coordinator {
    self.lastInteraction = NSProcessInfo.processInfo.systemUptime;
    if ([context.nextFocusedView isDescendantOfView:self.actions]) self.sheetOpener = context.nextFocusedView;
    [super didUpdateFocusInContext:context withAnimationCoordinator:coordinator];
    if (context.previouslyFocusedView == self.timeline && context.nextFocusedView != self.timeline) {
        [self endScan];
        self.pendingSeek = -1;
    }
    if (self.sheet && [context.nextFocusedView isDescendantOfView:self.options])
        [self.scroll scrollRectToVisible:[context.nextFocusedView convertRect:context.nextFocusedView.bounds toView:self.scroll] animated:YES];
}

- (void)beginSheet:(NSString *)title {
    [self.sheet removeFromSuperview];
    [self.preview removeFromSuperview];
    self.info = self.preview = nil;
    self.page = title;
    self.sheet = [UIView new];
    UIVisualEffect *effect;
    if (@available(tvOS 26.0, *)) effect = [UIGlassEffect effectWithStyle:UIGlassEffectStyleClear];
    else effect = [UIBlurEffect effectWithStyle:UIBlurEffectStyleDark];
    UIVisualEffectView *glass = [[UIVisualEffectView alloc] initWithEffect:effect];
    glass.frame = self.sheet.bounds;
    glass.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
    glass.userInteractionEnabled = NO;
    [self.sheet addSubview:glass];
    self.sheet.backgroundColor = [UIColor colorWithWhite:0.02 alpha:0.32];
    self.sheet.clipsToBounds = YES;
    self.sheet.layer.cornerRadius = 24;
    self.panel.hidden = self.introButton.hidden = YES;
    [self.view addSubview:self.sheet];
    self.scroll = [UIScrollView new];
    [self.sheet addSubview:self.scroll];
    self.options = [UIStackView new];
    self.options.axis = UILayoutConstraintAxisVertical;
    self.options.spacing = 14;
    self.options.translatesAutoresizingMaskIntoConstraints = NO;
    [self.scroll addSubview:self.options];
    UILayoutGuide *guide = self.scroll.contentLayoutGuide;
    [NSLayoutConstraint activateConstraints:@[
        [self.options.leadingAnchor constraintEqualToAnchor:guide.leadingAnchor],
        [self.options.trailingAnchor constraintEqualToAnchor:guide.trailingAnchor],
        [self.options.topAnchor constraintEqualToAnchor:guide.topAnchor],
        [self.options.bottomAnchor constraintEqualToAnchor:guide.bottomAnchor],
        [self.options.widthAnchor constraintEqualToAnchor:self.scroll.frameLayoutGuide.widthAnchor]]];
    UILabel *header = Label(38);
    header.text = title;
    [self.options addArrangedSubview:header];
    [self.view setNeedsLayout];
}

- (void)option:(NSString *)title action:(void (^)(MPVPlayer *))handler {
    UIButton *b = [UIButton buttonWithType:UIButtonTypeSystem];
    b.titleLabel.font = [UIFont systemFontOfSize:25 weight:UIFontWeightMedium];
    [b setTitle:title forState:UIControlStateNormal];
    [b.heightAnchor constraintGreaterThanOrEqualToConstant:56].active = YES;
    __weak MPVPlayer *owner = self;
    [b addAction:[UIAction actionWithHandler:^(UIAction *action) { if (owner) handler(owner); }]
        forControlEvents:UIControlEventPrimaryActionTriggered];
    [self.options addArrangedSubview:b];
}

- (void)finishSheet {
    [self.view layoutIfNeeded];
    for (UIView *v in self.options.arrangedSubviews) if ([v isKindOfClass:UIButton.class]) { [self focus:v]; break; }
}

- (void)closeSheet {
    [self.sheet removeFromSuperview];
    [self.preview removeFromSuperview];
    self.sheet = self.preview = self.info = nil;
    self.options = nil;
    self.scroll = nil;
    self.page = nil;
    self.panel.hidden = NO;
    [self focus:self.sheetOpener && !self.sheetOpener.hidden ? self.sheetOpener : self.pauseButton];
}

- (NSString *)outputColorName {
    CGColorSpaceRef space = self.surface.colorspace;
    return space ? ((__bridge NSString *)CGColorSpaceGetName(space) ?: @"SDR") : @"SDR";
}

- (void)matchDisplay {
    if ([self.media[@"matchRate"] isEqual:@NO]) return;
    AVDisplayManager *manager = self.view.window.avDisplayManager;
    double fps = [self number:"container-fps"];
    int width = (int)[self number:"width"], height = (int)[self number:"height"];
    if (!manager.displayCriteriaMatchingEnabled || fps < 1 || fps > 240 || width <= 0 || height <= 0) return;
    NSString *color = [self outputColorName];
    NSString *signature = [NSString stringWithFormat:@"%.4f:%d:%d:%@",fps,width,height,color];
    if ([signature isEqual:self.displaySignature]) return;
    BOOL pq = [color containsString:@"PQ"], hlg = [color containsString:@"HLG"];
    NSDictionary *extensions = @{
        (__bridge NSString *)kCMFormatDescriptionExtension_ColorPrimaries:
            (__bridge NSString *)(pq || hlg ? kCMFormatDescriptionColorPrimaries_ITU_R_2020 : kCMFormatDescriptionColorPrimaries_ITU_R_709_2),
        (__bridge NSString *)kCMFormatDescriptionExtension_TransferFunction:
            (__bridge NSString *)(pq ? kCMFormatDescriptionTransferFunction_SMPTE_ST_2084_PQ : hlg ? kCMFormatDescriptionTransferFunction_ITU_R_2100_HLG : kCMFormatDescriptionTransferFunction_ITU_R_709_2)
    };
    CMVideoFormatDescriptionRef format = NULL;
    if (CMVideoFormatDescriptionCreate(NULL, kCVPixelFormatType_32BGRA, width, height, (__bridge CFDictionaryRef)extensions, &format) == noErr) {
        manager.preferredDisplayCriteria = [[AVDisplayCriteria alloc] initWithRefreshRate:fps formatDescription:format];
        CFRelease(format);
        self.displaySignature = signature;
    }
}

- (NSDictionary *)media {
    return self.items[self.itemIndex][@"media"];
}

- (NSDictionary *)descriptor:(NSString *)base {
    return @{@"lang":[self string:[base stringByAppendingString:@"lang"]],
             @"title":[self string:[base stringByAppendingString:@"title"]]};
}

- (NSString *)trackKey:(NSString *)prop {
    NSString *series = self.media[@"seriesKey"];
    return [series isKindOfClass:NSString.class] && series.length ? [NSString stringWithFormat:@"tv.track.%@.%@", prop,series] : nil;
}

- (void)remember:(NSString *)prop descriptor:(NSDictionary *)descriptor {
    NSString *key = [self trackKey:prop];
    if (key) [NSUserDefaults.standardUserDefaults setObject:descriptor forKey:key];
}

- (void)restoreTracks {
    for (NSString *prop in @[@"sid",@"aid"]) {
        NSString *key = [self trackKey:prop];
        NSDictionary *wanted = key ? [NSUserDefaults.standardUserDefaults dictionaryForKey:key] : nil;
        if (!wanted) continue;
        if ([wanted[@"off"] boolValue]) { [self set:prop value:@"no"]; continue; }
        NSInteger best = 0;
        NSString *match = nil;
        for (NSInteger i=0; i<[self number:"track-list/count"]; i++) {
            NSString *base = [NSString stringWithFormat:@"track-list/%ld/",(long)i];
            if (![[self string:[base stringByAppendingString:@"type"]] isEqual:([prop isEqual:@"sid"] ? @"sub" : @"audio")]) continue;
            NSDictionary *candidate = [self descriptor:base];
            NSInteger score = [wanted[@"lang"] length] && [wanted[@"lang"] isEqual:candidate[@"lang"]] ? 1 : 0;
            if ([wanted[@"title"] length] && [wanted[@"title"] isEqual:candidate[@"title"]]) score += 2;
            if (score > best) { best = score; match = [self string:[base stringByAppendingString:@"id"]]; }
        }
        if (match) [self set:prop value:match];
    }
}

- (void)applyAudio {
    NSUserDefaults *defaults = NSUserDefaults.standardUserDefaults;
    [self set:@"af" value:[PlayerServices audioFilter:[defaults boolForKey:@"speech"] night:[defaults boolForKey:@"night"]]];
}

- (void)prepareSegments {
    NSMutableArray *chapters = [NSMutableArray array];
    for (NSUInteger i=0;i<self.chapters.count;i++) {
        NSString *title = [self string:[NSString stringWithFormat:@"chapter-list/%lu/title",(unsigned long)i]];
        title = [title stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
        NSString *kind = nil;
        NSDictionary *patterns = @{@"intro":@"opening|intro|op|заставка|вступление|опенинг",
            @"credits":@"credits|end credits|ending|outro|ed|титры|эндинг",
            @"recap":@"recap|previously|ранее|пересказ", @"preview":@"preview|анонс"};
        for (NSString *candidate in patterns) {
            NSString *pattern = [NSString stringWithFormat:@"^(%@)(\\b|$)",patterns[candidate]];
            if (title.length && [title rangeOfString:pattern options:NSRegularExpressionSearch|NSCaseInsensitiveSearch].location != NSNotFound) {
                kind = candidate;
                break;
            }
        }
        if (!kind) continue;
        NSNumber *end = i+1 < self.chapters.count ? self.chapters[i+1] : @(-1);
        if (end.doubleValue < 0 && ![kind isEqual:@"credits"]) continue;
        [chapters addObject:@{@"kind":kind, @"start":self.chapters[i], @"end":end}];
    }
    NSArray *source = self.items[self.itemIndex][@"skip"] ?: @[];
    self.skipSegments = [source arrayByAddingObjectsFromArray:chapters];
    NSInteger tmdb = [self.media[@"tmdb"] integerValue], episode = [self.media[@"episode"] integerValue];
    if (tmdb <= 0 || ([self.media[@"series"] boolValue] && !episode)) return;
    NSUInteger generation = self.generation;
    [PlayerServices intros:tmdb season:[self.media[@"season"] integerValue] episode:episode completion:^(NSArray *segments){
        if (generation == self.generation) self.skipSegments = [[source arrayByAddingObjectsFromArray:segments] arrayByAddingObjectsFromArray:chapters];
    }];
}

- (void)picture {
    [self beginSheet:@"Картинка"];
    NSDictionary *labels = @{@"brightness":@"Яркость", @"contrast":@"Контраст", @"gamma":@"Гамма", @"saturation":@"Насыщенность"};
    for (NSString *key in @[@"brightness",@"contrast",@"gamma",@"saturation"]) {
        int current = (int)[self number:key.UTF8String];
        for (NSNumber *delta in @[@(-5),@5]) {
            [self option:[NSString stringWithFormat:@"%@ %d  (%+d)",labels[key],current,delta.intValue] action:^(MPVPlayer *p){
                [p set:key value:@(MAX(-100,MIN(100,current+delta.intValue))).stringValue]; [p picture];
            }];
        }
    }
    NSString *transfer = [self string:@"video-params/gamma"];
    if ([@[@"bt.1886",@"srgb",@"gamma2.2",@"bt.709",@"gamma2.4"] containsObject:transfer]) {
        [self option:@"Ночной SDR" action:^(MPVPlayer *p){
            [p set:@"brightness" value:@"-8"]; [p set:@"gamma" value:@"5"]; [p set:@"contrast" value:@"0"]; [p set:@"saturation" value:@"0"]; [p picture];
        }];
    }
    [self option:@"Обычный · сбросить" action:^(MPVPlayer *p){ for (NSString *key in labels) [p set:key value:@"0"]; [p picture]; }];
    [self finishSheet];
}

- (void)subtitleMessage:(NSString *)message {
    [self beginSheet:@"Субтитры из интернета"];
    UILabel *label = Label(25); label.numberOfLines = 0; label.text = message;
    [self.options addArrangedSubview:label];
    [self option:@"Назад" action:^(MPVPlayer *p){ [p subs]; }];
    [self finishSheet];
}

- (void)onlineSubs {
    [self subtitleMessage:@"Поиск…"];
    UIView *searchSheet = self.sheet;
    NSUInteger generation = self.generation;
    NSInteger episode = [self.media[@"episode"] integerValue];
    if ([self.media[@"series"] boolValue] && episode <= 0) { [self subtitleMessage:@"В карточке отсутствует номер серии"]; return; }
    [PlayerServices subtitles:self.media[@"imdb"] ?: @"" season:[self.media[@"season"] integerValue] episode:episode completion:^(NSArray *rows, NSString *error){
        if (generation != self.generation || self.sheet != searchSheet) return;
        if (!rows.count) { [self subtitleMessage:error ?: @"Русские и английские субтитры не найдены"]; return; }
        [self beginSheet:@"Субтитры из интернета"];
        for (NSDictionary *row in rows) {
            NSString *title = [NSString stringWithFormat:@"%@ · %@",row[@"lang"],row[@"title"]];
            [self option:title action:^(MPVPlayer *p){
                [p subtitleMessage:@"Загрузка…"];
                UIView *loadingSheet = p.sheet;
                [PlayerServices download:row[@"url"] completion:^(NSURL *file){
                    if (p.generation != generation || p.sheet != loadingSheet) {
                        if (file) [NSFileManager.defaultManager removeItemAtURL:file error:nil];
                        return;
                    }
                    if (!file) { [p subtitleMessage:@"Не удалось загрузить субтитры"]; return; }
                    [p.subtitleFiles addObject:file];
                    const char *args[] = {"sub-add",file.path.UTF8String,"select",title.UTF8String,[row[@"lang"] UTF8String],NULL};
                    if (mpv_command(p->_player,args) < 0) [p subtitleMessage:@"Формат субтитров не поддерживается"];
                    else [p closeSheet];
                }];
            }];
        }
        [self finishSheet];
    }];
}

- (void)audio { [self tracks:NO]; }
- (void)subs { [self tracks:YES]; }
- (void)tracks:(BOOL)subs {
    [self beginSheet:subs ? @"Субтитры" : @"Звук"];
    NSString *prop = subs ? @"sid" : @"aid";
    NSString *selected = [self string:prop];
    if (subs) [self option:[selected isEqual:@"no"] ? @"✓ Выключены" : @"Выключены" action:^(MPVPlayer *p){
        [p remember:@"sid" descriptor:@{@"off":@YES}]; [p set:@"sid" value:@"no"]; [p closeSheet];
    }];
    NSInteger count = [self number:"track-list/count"];
    for (NSInteger i=0;i<count;i++) {
        NSString *base = [NSString stringWithFormat:@"track-list/%ld/",(long)i];
        if (![[self string:[base stringByAppendingString:@"type"]] isEqual:(subs ? @"sub" : @"audio")]) continue;
        NSString *track = [self string:[base stringByAppendingString:@"id"]];
        NSMutableArray *parts = [NSMutableArray array];
        for (NSString *key in @[@"lang",@"title",@"codec",@"demux-channel-count"]) {
            NSString *v = [self string:[base stringByAppendingString:key]];
            if (v.length) [parts addObject:[key isEqual:@"demux-channel-count"] ? [v stringByAppendingString:@" кан."] : v];
        }
        NSDictionary *descriptor = [self descriptor:base];
        NSString *name = parts.count ? [parts componentsJoinedByString:@" · "] : [@"Дорожка " stringByAppendingString:track];
        [self option:[track isEqual:selected] ? [@"✓ " stringByAppendingString:name] : name action:^(MPVPlayer *p){
            [p remember:prop descriptor:descriptor]; [p set:prop value:track]; [p closeSheet];
        }];
    }
    if (subs) {
        [self option:@"Найти субтитры в интернете" action:^(MPVPlayer *p){ [p onlineSubs]; }];
    } else {
        for (NSString *key in @[@"speech", @"night"]) {
            NSString *title = [key isEqual:@"speech"] ? @"Усиление речи" : @"Ночной режим";
            BOOL on = [NSUserDefaults.standardUserDefaults boolForKey:key];
            [self option:[NSString stringWithFormat:@"%@ · %@", title, on ? @"вкл" : @"выкл"] action:^(MPVPlayer *p){
                [NSUserDefaults.standardUserDefaults setBool:!on forKey:key]; [p applyAudio]; [p audio];
            }];
        }
    }
    NSString *delay = subs ? @"sub-delay" : @"audio-delay";
    double offset = [self number:delay.UTF8String];
    for (NSNumber *step in @[@(-0.1),@(0.1)]) {
        [self option:[NSString stringWithFormat:@"Сдвиг %+.1f с   (%+.1f)",offset,step.doubleValue] action:^(MPVPlayer *p){
            [p set:delay value:@(round((offset+step.doubleValue)*10)/10).stringValue]; [p tracks:subs];
        }];
    }
    if (subs) {
        double scale = [self number:"sub-scale"];
        [self option:[NSString stringWithFormat:@"Размер   %.0f %%",scale*100] action:^(MPVPlayer *p){
            [p set:@"sub-scale" value:@(scale>=1.95 ? 0.75 : scale+0.25).stringValue]; [p subs];
        }];
        BOOL box = [[self string:@"sub-border-style"] isEqual:@"opaque-box"];
        [self option:box ? @"Оформление   Подложка" : @"Оформление   Контур" action:^(MPVPlayer *p){
            [p set:@"sub-border-style" value:box ? @"outline-and-shadow" : @"opaque-box"];
            [p set:@"sub-back-color" value:@"#B0000000"]; [p subs];
        }];
        self.preview = Label(34*MAX(0.75,scale));
        self.preview.textAlignment = NSTextAlignmentCenter;
        self.preview.backgroundColor = box ? [UIColor colorWithWhite:0 alpha:0.7] : UIColor.clearColor;
        self.preview.layer.shadowOpacity = 1;
        self.preview.layer.shadowRadius = 2;
        self.preview.text = @"Образец субтитров";
        [self.view addSubview:self.preview];
    }
    [self finishSheet];
}

- (void)speedMenu {
    [self choices:@"Скорость" property:@"speed" labels:@[@"0,5×",@"0,75×",@"1×",@"1,25×",@"1,5×",@"2×"] values:@[@"0.5",@"0.75",@"1",@"1.25",@"1.5",@"2"]];
}

- (void)aspectMenu {
    [self choices:@"Формат изображения" property:@"panscan" labels:@[@"Вписать в экран",@"Заполнить экран"] values:@[@"0",@"1"]];
}

- (void)fileInfo {
    [self beginSheet:@"Информация о файле"];
    self.info = Label(29);
    self.info.numberOfLines = 0;
    [self.info setContentCompressionResistancePriority:UILayoutPriorityRequired forAxis:UILayoutConstraintAxisVertical];
    [self.options addArrangedSubview:self.info];
    [self option:@"Закрыть" action:^(MPVPlayer *p){ [p closeSheet]; }];
    [self refresh];
    [self finishSheet];
}

- (void)choices:(NSString *)title property:(NSString *)prop labels:(NSArray *)labels values:(NSArray *)values {
    [self beginSheet:title];
    double current = [self number:prop.UTF8String];
    for (NSUInteger i=0;i<values.count;i++) {
        NSString *v=values[i], *label=labels[i];
        [self option:fabs(current-v.doubleValue)<0.001 ? [@"✓ " stringByAppendingString:label] : label action:^(MPVPlayer *p){
            [p set:prop value:v]; [p closeSheet];
        }];
    }
    [self finishSheet];
}

- (void)chapterMenu {
    [self beginSheet:@"Главы"];
    for (NSUInteger i=0;i<self.chapters.count;i++) {
        double t = self.chapters[i].doubleValue;
        NSString *name = [self string:[NSString stringWithFormat:@"chapter-list/%lu/title",(unsigned long)i]];
        [self option:[NSString stringWithFormat:@"%@   %@",Clock(t),name.length ? name : @"Глава"] action:^(MPVPlayer *p){
            [p seek:t]; [p closeSheet];
        }];
    }
    [self finishSheet];
}

- (void)sleepMenu {
    [self beginSheet:@"Таймер сна"];
    for (NSNumber *n in @[@0,@15,@30,@45,@60]) {
        NSString *text = n.intValue ? [NSString stringWithFormat:@"%@ мин",n] : @"Выключить";
        [self option:text action:^(MPVPlayer *p){
            p.sleepDeadline = n.intValue ? NSProcessInfo.processInfo.systemUptime+n.doubleValue*60 : 0;
            [p closeSheet];
        }];
    }
    [self finishSheet];
}

- (void)stopPlayback {
    [self.artTask cancel];
    self.generation++;
    self.view.window.avDisplayManager.preferredDisplayCriteria = nil;
    self.displaySignature = nil;
    [self keepScreenAwake:NO];
    [self.timer invalidate];
    self.timer = nil;
    if (_player) {
        mpv_terminate_destroy(_player);
        _player = NULL;
    }
    for (NSURL *file in self.subtitleFiles) [NSFileManager.defaultManager removeItemAtURL:file error:nil];
    [self.subtitleFiles removeAllObjects];
}

- (void)viewWillDisappear:(BOOL)animated {
    [super viewWillDisappear:animated];
    [self savePosition];
    [self closeSheet];
    [self stopPlayback];
}

@end
