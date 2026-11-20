package outbound

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"time"
)

var (
	tencentCOSBucketHost = regexp.MustCompile(`^[a-z0-9-]+-[0-9]+\.cos\.[a-z0-9-]+\.myqcloud\.com$`)
	tencentCOSPublicDNS  = &net.Resolver{
		PreferGo: true,
		Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, network, "119.29.29.29:53")
		},
	}
	tencentCOSDirectTransport = newOutboundTransportWithEnvironmentProxy(func(ctx context.Context, host string) ([]net.IP, error) {
		return resolveTencentCOSHost(ctx, host, tencentCOSPublicDNS)
	}, false)
)

func IsStandardTencentCOSBucketURL(bucketURL *url.URL) bool {
	return bucketURL.Scheme == "https" && bucketURL.User == nil && (bucketURL.Port() == "" || bucketURL.Port() == "443") &&
		tencentCOSBucketHost.MatchString(normalizeOutboundHost(bucketURL.Hostname()))
}

func ValidateTencentCOSBucketURL(bucketURL *url.URL) error {
	if !IsStandardTencentCOSBucketURL(bucketURL) {
		_, err := ValidateOutboundURL(bucketURL.String())
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_, err := resolveTencentCOSHost(ctx, bucketURL.Hostname(), tencentCOSPublicDNS)
	return err
}

func TencentCOSHTTPClient(bucketURL *url.URL, timeout time.Duration) *http.Client {
	if !IsStandardTencentCOSBucketURL(bucketURL) {
		return OutboundHTTPClient(timeout)
	}
	if proxyURL, err := outboundProxyFromEnvironment(&http.Request{URL: bucketURL}); proxyURL != nil || err != nil {
		return OutboundHTTPClient(timeout)
	}
	bucketOrigin := bucketURL.Host
	return &http.Client{
		Transport: tencentCOSDirectTransport,
		Timeout:   timeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= maxOutboundRedirects || req.URL.Scheme != "https" || req.URL.User != nil || !strings.EqualFold(req.URL.Host, bucketOrigin) {
				return errors.New("腾讯云 COS 不允许跨源重定向或过多重定向")
			}
			return nil
		},
	}
}

func resolveTencentCOSHost(ctx context.Context, host string, publicDNS *net.Resolver) ([]net.IP, error) {
	host = normalizeOutboundHost(host)
	if !tencentCOSBucketHost.MatchString(host) {
		return resolveOutboundHostWithPolicy(ctx, host, false)
	}
	addresses, err := lookupOutboundHost(ctx, host, net.DefaultResolver)
	if err != nil {
		return nil, err
	}
	if !slices.ContainsFunc(addresses, blockedCustomRelayIP) {
		return addresses, nil
	}

	// Tencent's same-region DNS can return a link-local COS gateway. Dial a
	// verified public address while retaining the bucket hostname for TLS.
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	addresses, err = lookupOutboundHost(ctx, host, publicDNS)
	if err != nil {
		return nil, err
	}
	if slices.ContainsFunc(addresses, blockedCustomRelayIP) {
		return nil, BadAuthRequest("腾讯云 COS 公网解析返回了受限制的地址")
	}
	return addresses, nil
}
