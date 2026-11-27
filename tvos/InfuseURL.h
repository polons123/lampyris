#import "PlaybackURL.h"

static NSURL *HTTPURL(NSString *text) {
    NSString *input = [text stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    if (input.length == 0) return nil;
    NSURLComponents *parts = [NSURLComponents componentsWithString:input];
    NSString *scheme = parts.scheme.lowercaseString;
    if (!([scheme isEqualToString:@"https"] || [scheme isEqualToString:@"http"]) ||
        parts.host.length == 0 || parts.user || parts.password ||
        (parts.port && (parts.port.integerValue < 1 || parts.port.integerValue > 65535))) return nil;
    return parts.URL;
}

static NSURL *AuthenticatedStream(NSURL *url, id credentials) {
    NSURLComponents *parts = [NSURLComponents componentsWithURL:url resolvingAgainstBaseURL:NO];
    if ([credentials isKindOfClass:NSArray.class] && [credentials count] == 2 &&
        [credentials[0] isKindOfClass:NSString.class] && [credentials[1] isKindOfClass:NSString.class]) {
        parts.user = credentials[0];
        parts.password = credentials[1];
    }
    return parts.URL ?: url;
}

static NSString *Origin(NSURL *url) {
    NSURL *validated = HTTPURL(url.absoluteString);
    if (!validated) return nil;
    NSString *scheme = validated.scheme.lowercaseString;
    NSNumber *port = validated.port ?: ([scheme isEqualToString:@"https"] ? @443 : @80);
    return [NSString stringWithFormat:@"%@://%@:%@", scheme, validated.host.lowercaseString, port];
}

static NSString *QueryValue(NSURL *url, NSString *key) {
    NSURLComponents *parts = [NSURLComponents componentsWithURL:url resolvingAgainstBaseURL:NO];
    for (NSURLQueryItem *item in parts.queryItems) {
        if ([item.name isEqualToString:key]) return item.value;
    }
    return nil;
}


static BOOL IsInfuseAction(NSURL *url, NSString *action) {
    return [url.scheme.lowercaseString isEqual:@"infuse"] &&
        [url.host.lowercaseString isEqual:@"x-callback-url"] && [url.path isEqual:action] &&
        !url.user && !url.password && !url.port && !url.fragment;
}

static NSURL *PrepareInfuse(NSURL *url, NSString *session, NSDictionary *metadata,
                            NSMutableDictionary *receipts, NSMutableArray *addresses) {
    BOOL play = IsInfuseAction(url, @"/play");
    if (!play && !IsInfuseAction(url, @"/save")) return nil;
    NSURLComponents *parts = [NSURLComponents componentsWithURL:url resolvingAgainstBaseURL:NO];
    NSMutableArray *query = [NSMutableArray array];
    NSURL *next = nil;
    NSString *savedPosition = nil;
    BOOL hasStream = NO;
    BOOL suppliedFilename = NO;
    for (NSURLQueryItem *item in parts.queryItems) {
        NSString *name = item.name, *value = item.value;
        if ([name isEqual:@"url"]) {
            NSURL *stream = HTTPURL(value);
            if (!stream) return nil;
            if (savedPosition) [query addObject:[NSURLQueryItem queryItemWithName:@"position" value:savedPosition]];
            hasStream = YES;
            if (addresses && ![addresses containsObject:value]) [addresses addObject:value];
            NSDictionary *entry = metadata[value];
            NSString *key = ResumeKey(stream);
            NSString *content = [entry[@"resumeID"] length] ? [@"mpv.content." stringByAppendingString:entry[@"resumeID"]] : key;
            receipts[key] = content;
            NSNumber *pos = play ? [NSUserDefaults.standardUserDefaults objectForKey:content] : nil;
            savedPosition = pos.doubleValue > 0 ? @((long long)pos.doubleValue).stringValue : nil;
            value = AuthenticatedStream(stream, entry[@"credentials"]).absoluteString;
            NSString *filename = entry[@"filename"];
            suppliedFilename = [filename isKindOfClass:NSString.class] && filename.length > 0;
            if (suppliedFilename) {
                [query addObject:[NSURLQueryItem queryItemWithName:@"url" value:value]];
                [query addObject:[NSURLQueryItem queryItemWithName:@"filename" value:filename]];
                continue;
            }
        } else if ([name isEqual:@"filename"] && suppliedFilename) {
            continue;
        } else if ([name isEqual:@"x-success"]) {
            if (!play && [value.lowercaseString hasPrefix:@"infuse:"]) {
                NSURL *nested = [NSURL URLWithString:value];
                if (!IsInfuseAction(nested, @"/play")) return nil;
                next = PrepareInfuse(nested, session, metadata, receipts, addresses);
                if (!next) return nil;
            }
            continue;
        } else if ([name isEqual:@"position"] && play) {
            if (savedPosition) value = savedPosition;
            savedPosition = nil;
        } else if ([name isEqual:@"sub"]) {
            if (!HTTPURL(value)) return nil;
        } else if (![@[@"filename", @"download"] containsObject:name]) continue;
        [query addObject:[NSURLQueryItem queryItemWithName:name value:value]];
    }
    if (!hasStream) return nil;
    if (savedPosition) [query addObject:[NSURLQueryItem queryItemWithName:@"position" value:savedPosition]];
    for (NSString *name in @[@"x-success", @"x-error"]) {
        BOOL success = [name isEqual:@"x-success"];
        NSString *target = success && next ? next.absoluteString :
            [NSString stringWithFormat:@"lampyristv://%@/%@", success ? @"infuseDidFinish" : @"infuseDidFail", session];
        [query addObject:[NSURLQueryItem queryItemWithName:name value:target]];
    }
    NSCharacterSet *unreserved = [NSCharacterSet characterSetWithCharactersInString:
        @"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"];
    NSMutableArray *pairs = [NSMutableArray array];
    for (NSURLQueryItem *field in query) {
        NSString *encoded = [field.value stringByAddingPercentEncodingWithAllowedCharacters:unreserved];
        [pairs addObject:[NSString stringWithFormat:@"%@=%@", field.name, encoded ?: @""]];
    }
    parts.percentEncodedQuery = [pairs componentsJoinedByString:@"&"];
    return parts.URL;
}
