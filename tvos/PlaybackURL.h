#import <Foundation/Foundation.h>
#import <CommonCrypto/CommonDigest.h>

static inline NSString *ResumeKey(NSURL *url) {
    NSURLComponents *parts = [NSURLComponents componentsWithURL:url resolvingAgainstBaseURL:NO];
    parts.user = nil;
    parts.password = nil;
    NSData *data = [parts.string dataUsingEncoding:NSUTF8StringEncoding];
    unsigned char digest[CC_SHA256_DIGEST_LENGTH];
    CC_SHA256(data.bytes, (CC_LONG)data.length, digest);
    return [@"mpv.position." stringByAppendingString:[[NSData dataWithBytes:digest length:sizeof(digest)] base64EncodedStringWithOptions:0]];
}
