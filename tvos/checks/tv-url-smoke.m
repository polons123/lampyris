#import "../InfuseURL.h"

int main(void) {
    @autoreleasepool {
        NSCAssert(HTTPURL(@"http://192.0.2.10:9118/lampa") != nil, @"Local HTTP URL");
        NSCAssert(HTTPURL(@"https://[2001:db8::1]:9443/") != nil, @"IPv6 HTTPS URL");
        NSCAssert(HTTPURL(@"https://name:pass@example.com/") == nil, @"Userinfo");
        NSCAssert(HTTPURL(@"https://example.com:70000") == nil, @"Port");
        NSCAssert(HTTPURL(@"file:///tmp/test") == nil, @"Unsupported scheme");
        NSCAssert([Origin(HTTPURL(@"https://example.com:443/foo")) isEqualToString:Origin(HTTPURL(@"https://EXAMPLE.com/bar"))], @"Same origin");
        NSCAssert(![Origin(HTTPURL(@"https://example.com/foo")) isEqualToString:Origin(HTTPURL(@"https://example.com:9443/foo"))], @"Different origin");
        NSURL *video = HTTPURL(@"https://example.com/a%2Bb?q=a+b&sig=%2F%2B%3D#t=2");
        NSURLComponents *input = [NSURLComponents componentsWithString:@"infuse://x-callback-url/play"];
        NSURL *second = HTTPURL(@"http://example.test/stream/B?link=test&index=2");
        input.queryItems = @[[NSURLQueryItem queryItemWithName:@"url" value:video.absoluteString],
            [NSURLQueryItem queryItemWithName:@"filename" value:@"A + B"],
            [NSURLQueryItem queryItemWithName:@"sub" value:@"https://example.com/sub.vtt"],
            [NSURLQueryItem queryItemWithName:@"position" value:@"42"],
            [NSURLQueryItem queryItemWithName:@"url" value:second.absoluteString]];
        NSMutableDictionary *receipts = [NSMutableDictionary dictionary];
        NSDictionary *meta = @{second.absoluteString:@{@"credentials":@[@"user", @"a@b:c"], @"resumeID":@"episode-two", @"filename":@"Хищник + Badlands.mkv"}};
        NSURL *infuse = PrepareInfuse(input.URL, @"test", meta, receipts, nil);
        NSArray *fields = [NSURLComponents componentsWithURL:infuse resolvingAgainstBaseURL:NO].queryItems;
        NSCAssert([fields[4] value] && [[NSURLComponents componentsWithString:[fields[4] value]].password isEqual:@"a@b:c"], @"Second item credentials");
        NSCAssert([[fields[5] name] isEqual:@"filename"] && [[fields[5] value] isEqual:@"Хищник + Badlands.mkv"], @"Second stream filename");
        NSCAssert([receipts[ResumeKey(second)] isEqual:@"mpv.content.episode-two"], @"Second episode receipt");
        NSCAssert([[fields[1] value] isEqual:@"A + B"] && [[fields[3] value] isEqual:@"42"], @"Per-item fields");
        NSURLComponents *save = [NSURLComponents componentsWithString:@"infuse://x-callback-url/save"];
        save.queryItems = @[fields[0], [NSURLQueryItem queryItemWithName:@"x-success" value:input.URL.absoluteString]];
        NSURL *nested = PrepareInfuse(save.URL, @"test", meta, receipts, nil);
        NSCAssert([QueryValue(nested, @"x-success") isEqual:infuse.absoluteString], @"Nested play");
        NSCAssert([QueryValue(infuse, @"url") isEqualToString:video.absoluteString], @"Nested video URL");
        NSCAssert([infuse.absoluteString containsString:@"url=https%3A%2F%2Fexample.com%2F"], @"Encode the entire nested URL");
        NSCAssert(![infuse.absoluteString containsString:@"+"], @"Plus escaping");
        NSCAssert([QueryValue(infuse, @"x-success") isEqualToString:@"lampyristv://infuseDidFinish/test"], @"Success callback");
        puts("URL and Infuse callback smoke test passed");
    }
}
