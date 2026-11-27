#import <UIKit/UIKit.h>

@interface MPVPlayer : UIViewController
@property (nonatomic, copy) void (^progressHandler)(NSString *token, double time, double duration);
@property (nonatomic, copy) void (^webRequest)(BOOL stats, NSString *key, void (^done)(NSString *));
- (instancetype)initWithItems:(NSArray<NSDictionary *> *)items;
@end
