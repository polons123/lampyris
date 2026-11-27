#import <UIKit/UIKit.h>
#import <dlfcn.h>
#import "MPVPlayer.h"

static NSString *const ServerKey = @"LampyrisServerURL";
static NSString *const WebKitPath = @"/System/Library/Frameworks/WebKit.framework/WebKit";

// WebKit доступен во время выполнения, хотя tvOS SDK не предоставляет его заголовки.
@protocol LampyrisContentWorld
+ (id)pageWorld;
@end

@protocol LampyrisWebView
- (instancetype)initWithFrame:(CGRect)frame configuration:(id)configuration;
@property (nonatomic, weak) id navigationDelegate;
@property (nonatomic, weak) id UIDelegate;
@property (nonatomic, copy) NSString *customUserAgent;
@property (nonatomic, readonly) NSURL *URL;
@property (nonatomic, readonly) UIScrollView *scrollView;
- (id)loadRequest:(NSURLRequest *)request;
- (void)callAsyncJavaScript:(NSString *)script arguments:(NSDictionary *)args inFrame:(id)frame inContentWorld:(id)world completionHandler:(void (^)(id, NSError *))handler;
- (void)evaluateJavaScript:(NSString *)source completionHandler:(void (^)(id, NSError *))completionHandler;
@end

@protocol LampyrisNavigationAction
@property (nonatomic, readonly) NSURLRequest *request;
@property (nonatomic, readonly) id targetFrame;
@property (nonatomic, readonly) id sourceFrame;
@end

@protocol LampyrisFrame
@property (nonatomic, readonly, getter=isMainFrame) BOOL mainFrame;
@property (nonatomic, readonly) NSURLRequest *request;
@end

typedef NS_ENUM(NSInteger, LampyrisNavigationPolicy) {
    LampyrisCancel = 0,
    LampyrisAllow = 1
};

static NSString *Tr(NSString *ru, NSString *en) {
    NSString *language = NSLocale.preferredLanguages.firstObject.lowercaseString;
    return [language hasPrefix:@"ru"] ? ru : en;
}

#import "InfuseURL.h"

@interface TVController : UIViewController
@property (nonatomic, strong) UIView<LampyrisWebView> *web;
@property (nonatomic, strong) NSURL *server;
@property (nonatomic, copy) NSString *remoteScript;
@property (nonatomic) BOOL choosingPlayer;
@property (nonatomic, copy) NSDictionary *infuseItems;
- (BOOL)handleCallback:(NSURL *)url;
@end

@implementation TVController

- (void)viewDidLoad {
    [super viewDidLoad];
    self.view.backgroundColor = UIColor.blackColor;
    NSString *path = [NSBundle.mainBundle pathForResource:@"Remote" ofType:@"js"];
    self.remoteScript = path ? [NSString stringWithContentsOfFile:path encoding:NSUTF8StringEncoding error:NULL] : nil;
    if (!dlopen(WebKitPath.fileSystemRepresentation, RTLD_NOW | RTLD_LOCAL)) {
        dlopen("/System/Library/PrivateFrameworks/WebKit.framework/WebKit", RTLD_NOW | RTLD_LOCAL);
    }
    Class webClass = NSClassFromString(@"WKWebView");
    Class configClass = NSClassFromString(@"WKWebViewConfiguration");

    if (webClass && configClass) {
        UIView<LampyrisWebView> *web = [webClass alloc];
        self.web = [web initWithFrame:self.view.bounds configuration:[configClass new]];
        self.web.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
        self.web.scrollView.contentInsetAdjustmentBehavior = UIScrollViewContentInsetAdjustmentNever;
        self.web.navigationDelegate = self;
        self.web.UIDelegate = self;
        self.web.customUserAgent = @"Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15 LampyrisTV";
        [self.view addSubview:self.web];
    }
    [self installRemoteButtons];
    NSUserDefaults *defaults = NSUserDefaults.standardUserDefaults;
    NSString *saved = [defaults persistentDomainForName:NSBundle.mainBundle.bundleIdentifier][ServerKey] ?: [defaults stringForKey:ServerKey];
    self.server = HTTPURL(saved) ?: [NSURL URLWithString:@"https://yumata.github.io/lampa/"];
    [self loadServer];
}

- (void)installRemoteButtons {
    NSArray<NSNumber *> *pressTypes = @[
        @(UIPressTypeUpArrow), @(UIPressTypeDownArrow), @(UIPressTypeLeftArrow),
        @(UIPressTypeRightArrow), @(UIPressTypeSelect), @(UIPressTypeMenu), @(UIPressTypePlayPause)
    ];
    for (NSNumber *pressType in pressTypes) {
        UITapGestureRecognizer *tap = [[UITapGestureRecognizer alloc] initWithTarget:self action:@selector(remoteTapped:)];
        tap.allowedPressTypes = @[pressType];
        tap.allowedTouchTypes = @[];
        [self.view addGestureRecognizer:tap];
    }
}

- (void)remoteTapped:(UITapGestureRecognizer *)tap {
    [self remotePressed:(UIPressType)tap.allowedPressTypes.firstObject.integerValue];
}

- (void)viewDidAppear:(BOOL)animated {
    [super viewDidAppear:animated];
    if (!self.web) [self showMessage:Tr(@"WebKit недоступен на этой версии tvOS.",
                                       @"WebKit is unavailable on this version of tvOS.")];
}

- (void)loadServer {
    [self.web loadRequest:[NSURLRequest requestWithURL:self.server]];
}

- (void)showMessage:(NSString *)message {
    if (self.presentedViewController || !self.view.window) return;
    UIAlertController *alert = [UIAlertController alertControllerWithTitle:@"Lampyris TV"
                                                                    message:message
                                                             preferredStyle:UIAlertControllerStyleAlert];
    [alert addAction:[UIAlertAction actionWithTitle:@"OK" style:UIAlertActionStyleCancel handler:nil]];
    [self presentViewController:alert animated:YES completion:nil];
}

- (void)showServerSettings {
    if (self.presentedViewController) return;
    UIAlertController *alert = [UIAlertController alertControllerWithTitle:Tr(@"Адрес Lampa", @"Lampa address")
                                                                    message:Tr(@"Нажмите OK на поле. Введите новый URL с https:// или http:// и выберите «Готово».",
                                                                               @"Select the field, enter a new URL starting with https:// or http://, then choose Done.")
                                                             preferredStyle:UIAlertControllerStyleAlert];
    [alert addTextFieldWithConfigurationHandler:^(UITextField *field) {
        field.placeholder = @"https://";
        field.text = self.server.absoluteString;
        field.keyboardType = UIKeyboardTypeASCIICapable;
        field.autocorrectionType = UITextAutocorrectionTypeNo;
        field.autocapitalizationType = UITextAutocapitalizationTypeNone;
        field.clearButtonMode = UITextFieldViewModeWhileEditing;
        field.returnKeyType = UIReturnKeyDone;
    }];
    __weak TVController *controller = self;
    UITextField *addressField = alert.textFields.firstObject;
    [alert addAction:[UIAlertAction actionWithTitle:Tr(@"Открыть", @"Open") style:UIAlertActionStyleDefault handler:^(UIAlertAction *action) {
        TVController *owner = controller;
        NSURL *url = HTTPURL(addressField.text);
        if (url) {
            owner.server = url;
            [NSUserDefaults.standardUserDefaults setObject:url.absoluteString forKey:ServerKey];
            [owner loadServer];
        } else {
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.5 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
                [owner showMessage:Tr(@"Проверьте адрес сервера.", @"Check the server address.")];
            });
        }
    }]];
    [alert addAction:[UIAlertAction actionWithTitle:Tr(@"Отмена", @"Cancel") style:UIAlertActionStyleCancel handler:nil]];
    [self presentViewController:alert animated:YES completion:nil];
}

// WebKit resumes the requesting document only after the native dialog is dismissed.
- (void)webView:(id)webView runJavaScriptTextInputPanelWithPrompt:(NSString *)prompt
    defaultText:(NSString *)defaultText initiatedByFrame:(id<LampyrisFrame>)frame
    completionHandler:(void (^)(NSString *))reply {
    if ([prompt isEqual:@"lampyris:server"] && frame.isMainFrame &&
        [Origin(self.server) isEqual:Origin(frame.request.URL)]) {
        reply(nil);
        dispatch_async(dispatch_get_main_queue(), ^{ [self showServerSettings]; });
        return;
    }
    if (![prompt isEqualToString:@"lampyris:password"] || !frame.isMainFrame ||
        ![Origin(self.server) isEqualToString:Origin(frame.request.URL)] ||
        self.presentedViewController || !self.view.window) {
        reply(nil);
        return;
    }
    UIAlertController *alert = [UIAlertController alertControllerWithTitle:Tr(@"Пароль", @"Password")
        message:self.server.host preferredStyle:UIAlertControllerStyleAlert];
    [alert addTextFieldWithConfigurationHandler:^(UITextField *field) {
        field.placeholder = Tr(@"Введите пароль", @"Enter password");
        field.secureTextEntry = YES;
        field.textContentType = UITextContentTypePassword;
        field.autocapitalizationType = UITextAutocapitalizationTypeNone;
        field.autocorrectionType = UITextAutocorrectionTypeNo;
        field.returnKeyType = UIReturnKeyDone;
    }];
    UITextField *field = alert.textFields.firstObject;
    [alert addAction:[UIAlertAction actionWithTitle:Tr(@"Войти", @"Sign in")
        style:UIAlertActionStyleDefault handler:^(UIAlertAction *action) {
            NSString *password = field.text;
            field.text = nil;
            reply(password.length ? password : nil);
        }]];
    [alert addAction:[UIAlertAction actionWithTitle:Tr(@"Отмена", @"Cancel")
        style:UIAlertActionStyleCancel handler:^(UIAlertAction *action) {
            field.text = nil;
            reply(nil);
        }]];
    [self presentViewController:alert animated:YES completion:^{
        [field becomeFirstResponder];
    }];
}

- (void)remotePressed:(UIPressType)type {
    if (self.presentedViewController) return;
    NSInteger keyCode;
    switch (type) {
        case UIPressTypeSelect: keyCode = 13; break;
        case UIPressTypeMenu: keyCode = 27; break;
        case UIPressTypeLeftArrow: keyCode = 37; break;
        case UIPressTypeUpArrow: keyCode = 38; break;
        case UIPressTypeRightArrow: keyCode = 39; break;
        case UIPressTypeDownArrow: keyCode = 40; break;
        case UIPressTypePlayPause: [self showServerSettings]; return;
        default: return;
    }
    NSString *script = [NSString stringWithFormat:@"window.lampyrisTVKey && window.lampyrisTVKey(%ld)", (long)keyCode];
    [self.web evaluateJavaScript:script completionHandler:nil];
}

- (void)openVideo:(NSURL *)url {
    NSString *scheme = url.scheme.lowercaseString;
    NSURL *video = nil;
    if ([scheme isEqualToString:@"lampa"] && [url.host.lowercaseString isEqualToString:@"video"]) {
        video = HTTPURL(QueryValue(url, @"src"));
    } else if ([scheme isEqualToString:@"infuse"] &&
               [url.host.lowercaseString isEqualToString:@"x-callback-url"] && (IsInfuseAction(url, @"/play") || IsInfuseAction(url, @"/save"))) {
        video = HTTPURL(QueryValue(url, @"url"));
    }
    if (!video || self.choosingPlayer || self.presentedViewController) return;
    self.choosingPlayer = YES;
    BOOL infuse = [scheme isEqualToString:@"infuse"];
    NSMutableArray *arguments = [NSMutableArray arrayWithObject:video.absoluteString];
    for (NSString *name in @[@"playlist", @"segments"]) {
        NSData *data = [QueryValue(url, name) dataUsingEncoding:NSUTF8StringEncoding];
        id value = data.length ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
        [arguments addObject:value ?: NSNull.null];
    }
    NSString *session = NSUUID.UUID.UUIDString;
    NSMutableArray *addresses = [NSMutableArray array];
    if (infuse && !PrepareInfuse(url, session, nil, nil, addresses)) {
        self.choosingPlayer = NO;
        return;
    }
    [arguments addObject:addresses];
    NSData *argument = [NSJSONSerialization dataWithJSONObject:arguments options:0 error:nil];
    NSString *json = [[NSString alloc] initWithData:argument encoding:NSUTF8StringEncoding];
    NSString *script = infuse ? [NSString stringWithFormat:@"window.lampyrisInfuseItems?.(...%@)", json]
        : [NSString stringWithFormat:@"window.lampyrisPlaybackItems?.(...%@)", json];
    [self.web evaluateJavaScript:script completionHandler:^(id credentials, NSError *error) {
        self.choosingPlayer = NO;
        if (self.presentedViewController || ![Origin(self.server) isEqual:Origin(self.web.URL)]) return;
        if (infuse) {
            NSDictionary *metadata = [credentials isKindOfClass:NSDictionary.class] ? credentials : @{};
            NSMutableDictionary *receipts = [NSMutableDictionary dictionary];
            NSURL *launch = PrepareInfuse(url, session, metadata, receipts, nil);
            if (!launch) return;
            NSMutableDictionary *items = [NSMutableDictionary dictionary];
            for (NSString *address in addresses) {
                NSDictionary *item = metadata[address];
                if (item) items[ResumeKey(HTTPURL(address))] = item;
            }
            self.infuseItems = items;
            [NSUserDefaults.standardUserDefaults setObject:@{@"id":session, @"items":receipts} forKey:@"infuse.launch"];
            NSLog(@"Lampyris Infuse launch (%lu streams)", (unsigned long)addresses.count);
            [self launchInfuseStream:launch];
        } else {
            NSMutableArray *items = [NSMutableArray array];
            if ([credentials isKindOfClass:NSArray.class]) {
                for (id entry in credentials) {
                    if (![entry isKindOfClass:NSDictionary.class] || ![entry[@"url"] isKindOfClass:NSString.class]) continue;
                    NSURL *source = HTTPURL(entry[@"url"]);
                    if (!source) continue;
                    [items addObject:@{@"url": AuthenticatedStream(source, entry[@"credentials"]),
                        @"artwork": HTTPURL([entry[@"artwork"] isKindOfClass:NSString.class] ? entry[@"artwork"] : nil) ?: NSNull.null,
                        @"coverTitle": [entry[@"coverTitle"] isKindOfClass:NSString.class] ? entry[@"coverTitle"] : @"",
                        @"selected": @([entry[@"selected"] isEqual:@YES]),
                        @"media": [entry[@"media"] isKindOfClass:NSDictionary.class] ? entry[@"media"] : @{},
                        @"token": entry[@"token"] ?: @"", @"resumeID": entry[@"resumeID"] ?: @"",
                        @"resumeUpdated": entry[@"resumeUpdated"] ?: @0, @"resume": entry[@"resume"] ?: @0, @"title": entry[@"title"] ?: @"", @"skip": entry[@"skip"] ?: @[]}];
                }
            }
            if (!items.count) [items addObject:@{@"url": video}];
            MPVPlayer *player = [[MPVPlayer alloc] initWithItems:items];
            player.webRequest = ^(BOOL stats, NSString *key, void (^done)(NSString *)) {
                Class<LampyrisContentWorld> world = NSClassFromString(@"WKContentWorld");
                if (![Origin(self.server) isEqual:Origin(self.web.URL)] || !world ||
                    ![self.web respondsToSelector:@selector(callAsyncJavaScript:arguments:inFrame:inContentWorld:completionHandler:)]) {
                    done(nil);
                    return;
                }
                NSString *script = stats ? @"return await window.lampyrisTorrentStats(key)" : @"return await window.lampyrisResolveTorBox(key)";
                [self.web callAsyncJavaScript:script arguments:@{@"key":key} inFrame:nil inContentWorld:[world pageWorld]
                    completionHandler:^(id value, NSError *error) { done([value isKindOfClass:NSString.class] ? value : nil); }];
            };
            player.progressHandler = ^(NSString *token, double time, double duration) {
                NSData *payload = [NSJSONSerialization dataWithJSONObject:@[token, @(time), @(duration)] options:0 error:nil];
                NSString *args = [[NSString alloc] initWithData:payload encoding:NSUTF8StringEncoding];
                [self.web evaluateJavaScript:[NSString stringWithFormat:@"window.lampyrisSaveProgress?.(...%@)", args] completionHandler:nil];
            };
            [self presentViewController:player animated:YES completion:nil];
        }
    }];
}

- (void)launchInfuseStream:(NSURL *)video {
    [UIApplication.sharedApplication openURL:video options:@{} completionHandler:^(BOOL opened) {
        if (!opened) [self showMessage:Tr(@"Не удалось открыть Infuse. Проверьте, что он установлен.",
                                           @"Could not open Infuse. Check that it is installed.")];
    }];
}

- (BOOL)handleCallback:(NSURL *)url {
    if (![url.scheme.lowercaseString isEqualToString:@"lampyristv"]) return NO;
    NSString *host = url.host.lowercaseString;
    NSUserDefaults *defaults = NSUserDefaults.standardUserDefaults;
    NSDictionary *launch = [defaults dictionaryForKey:@"infuse.launch"];
    if (![url.lastPathComponent isEqual:launch[@"id"]]) return NO;
    BOOL failed = [host isEqual:@"infusedidfail"];
    if (!failed && ![host isEqual:@"infusedidfinish"]) return NO;
    [defaults removeObjectForKey:@"infuse.launch"];
    if (failed) {
        dispatch_async(dispatch_get_main_queue(), ^{
            [self showMessage:Tr(@"Infuse не смог воспроизвести видео.", @"Infuse could not play the video.")];
        });
        return YES;
    }
    NSString *last = QueryValue(url, @"lastPlayedUrl");
    NSURLComponents *parts = last ? [NSURLComponents componentsWithString:last] : nil;
    parts.user = nil;
    parts.password = nil;
    NSURL *stream = HTTPURL(parts.string);
    NSString *digest = stream ? ResumeKey(stream) : nil;
    NSString *key = digest ? launch[@"items"][digest] : nil;
    NSString *value = QueryValue(url, @"position");
    NSScanner *scanner = value.length ? [NSScanner scannerWithString:value] : nil;
    double time;
    if (key && [scanner scanDouble:&time] && scanner.isAtEnd && isfinite(time) && time >= 0) {
        [defaults setDouble:time forKey:key];
        NSDictionary *item = self.infuseItems[digest];
        if (item[@"token"] && [item[@"duration"] doubleValue] > 0 && [Origin(self.server) isEqual:Origin(self.web.URL)]) {
            NSData *payload = [NSJSONSerialization dataWithJSONObject:@[item[@"token"], @(time), item[@"duration"]] options:0 error:nil];
            NSString *args = [[NSString alloc] initWithData:payload encoding:NSUTF8StringEncoding];
            [self.web evaluateJavaScript:[NSString stringWithFormat:@"window.lampyrisSaveProgress?.(...%@)", args] completionHandler:nil];
        }
        NSLog(@"Lampyris Infuse saved matching playback position");
    }
    self.infuseItems = nil;
    return YES;
}

- (void)webView:(id)webView decidePolicyForNavigationAction:(id<LampyrisNavigationAction>)action
 decisionHandler:(void (^)(LampyrisNavigationPolicy))decisionHandler {
    NSURL *url = action.request.URL;
    NSString *scheme = url.scheme.lowercaseString;
    id<LampyrisFrame> target = action.targetFrame;
    id<LampyrisFrame> source = action.sourceFrame;
    NSString *trustedOrigin = Origin(self.server);
    if ([scheme isEqualToString:@"lampa"] || [scheme isEqualToString:@"infuse"]) {
        decisionHandler(LampyrisCancel);
        if (source.isMainFrame && [trustedOrigin isEqualToString:Origin(source.request.URL)] &&
            [trustedOrigin isEqualToString:Origin(self.web.URL)]) {
            if ([scheme isEqual:@"lampa"] && [url.host.lowercaseString isEqual:@"showadvancedmenu"]) [self showServerSettings];
            else [self openVideo:url];
        }
        return;
    }
    BOOL configuredPage = [trustedOrigin isEqualToString:Origin(url)];
    BOOL webSubframe = target && !target.isMainFrame &&
        (HTTPURL(url.absoluteString) || [url.absoluteString isEqualToString:@"about:blank"] ||
         [scheme isEqualToString:@"blob"]);
    if (target) {
        decisionHandler(configuredPage || webSubframe ? LampyrisAllow : LampyrisCancel);
    } else {
        decisionHandler(LampyrisCancel);
        if (configuredPage && source.isMainFrame) [self.web loadRequest:action.request];
    }
}

- (void)webView:(id)webView didFinishNavigation:(id)navigation {
    if (self.remoteScript) [self.web evaluateJavaScript:self.remoteScript completionHandler:nil];
}

- (void)webView:(id)webView didFailProvisionalNavigation:(id)navigation withError:(NSError *)error {
    if (error.code == NSURLErrorCancelled || [error.domain isEqualToString:@"WebKitErrorDomain"]) return;
    NSLog(@"Lampyris TV navigation failed (%@ %ld)", error.domain, (long)error.code);
    if (self.presentedViewController || !self.view.window) return;
    UIAlertController *alert = [UIAlertController alertControllerWithTitle:@"Lampyris TV"
                                                                    message:Tr(@"Не удалось загрузить Lampa.", @"Could not load Lampa.")
                                                             preferredStyle:UIAlertControllerStyleAlert];
    __weak TVController *controller = self;
    [alert addAction:[UIAlertAction actionWithTitle:Tr(@"Повторить", @"Retry") style:UIAlertActionStyleDefault handler:^(UIAlertAction *action) {
        [controller loadServer];
    }]];
    [alert addAction:[UIAlertAction actionWithTitle:Tr(@"Изменить адрес", @"Change address") style:UIAlertActionStyleDefault handler:^(UIAlertAction *action) {
        UIViewController *presented = controller.presentedViewController;
        if (presented) {
            [presented dismissViewControllerAnimated:YES completion:^{ [controller showServerSettings]; }];
        } else {
            [controller showServerSettings];
        }
    }]];
    [self presentViewController:alert animated:YES completion:nil];
}

@end

@interface TVSceneDelegate : UIResponder <UIWindowSceneDelegate>
@property (nonatomic, strong) UIWindow *window;
@property (nonatomic, strong) TVController *controller;
@end

@implementation TVSceneDelegate
- (void)scene:(UIScene *)scene willConnectToSession:(UISceneSession *)session
      options:(UISceneConnectionOptions *)options {
    if (![scene isKindOfClass:UIWindowScene.class]) return;
    self.window = [[UIWindow alloc] initWithWindowScene:(UIWindowScene *)scene];
    self.controller = [TVController new];
    self.window.rootViewController = self.controller;
    [self.window makeKeyAndVisible];
    [self scene:scene openURLContexts:options.URLContexts];
}

- (void)scene:(UIScene *)scene openURLContexts:(NSSet<UIOpenURLContext *> *)contexts {
    for (UIOpenURLContext *context in contexts) {
        [self.controller handleCallback:context.URL];
    }
}
@end

@interface AppDelegate : UIResponder <UIApplicationDelegate>
@end

@implementation AppDelegate
@end

int main(int argc, char *argv[]) {
    @autoreleasepool {
        return UIApplicationMain(argc, argv, nil, NSStringFromClass(AppDelegate.class));
    }
}
