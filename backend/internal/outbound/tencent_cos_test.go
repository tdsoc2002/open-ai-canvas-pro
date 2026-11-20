package outbound

import (
	"net"
	"net/http"
	"net/url"
	"testing"
	"time"

	"yingce/backend/internal/outbound/outboundtest"
)

func TestTencentCOSResolvesPubliclyWhenSystemDNSReturnsRestrictedAddresses(t *testing.T) {
	const bucket = "test-bucket-1250000000.cos.ap-nanjing.myqcloud.com"
	const custom = "storage.example"
	for _, tt := range []struct {
		name   string
		host   string
		system [4]byte
		public [4]byte
		want   string
	}{
		{"system public address", bucket, [4]byte{1, 1, 1, 1}, [4]byte{8, 8, 8, 8}, "1.1.1.1"},
		{"same-region COS", bucket, [4]byte{169, 254, 0, 47}, [4]byte{8, 8, 8, 8}, "8.8.8.8"},
		{"restricted answer from public DNS", bucket, [4]byte{169, 254, 0, 47}, [4]byte{127, 0, 0, 1}, ""},
		{"custom endpoint", custom, [4]byte{169, 254, 0, 47}, [4]byte{8, 8, 8, 8}, ""},
	} {
		t.Run(tt.name, func(t *testing.T) {
			outboundtest.DNS(t, tt.public, tt.host)
			previousPublicDNS := tencentCOSPublicDNS
			tencentCOSPublicDNS = net.DefaultResolver
			t.Cleanup(func() { tencentCOSPublicDNS = previousPublicDNS })
			outboundtest.DNS(t, tt.system, tt.host)
			target := &url.URL{Scheme: "https", Host: tt.host, Path: "/ref.png", RawQuery: "q-signature=fixture"}
			if err := ValidateTencentCOSBucketURL(target); (err == nil) != (tt.want != "") {
				t.Fatalf("validating COS URL returned %v, want address %q", err, tt.want)
			}
			ips, err := resolveTencentCOSHost(t.Context(), tt.host, tencentCOSPublicDNS)
			if tt.want == "" {
				if err == nil || len(ips) != 0 {
					t.Fatalf("restricted endpoint resolved to %v, err=%v", ips, err)
				}
				return
			}
			if err != nil || len(ips) != 1 || ips[0].String() != tt.want {
				t.Fatalf("resolved to %v, err=%v; want %s", ips, err, tt.want)
			}
		})
	}
}

func TestTencentCOSClientLimitsPublicFallbackToOfficialHTTPSOrigin(t *testing.T) {
	t.Setenv("HTTPS_PROXY", "")
	t.Setenv("https_proxy", "")
	for _, tt := range []struct {
		raw       string
		dedicated bool
	}{
		{"https://test-bucket-1250000000.cos.ap-nanjing.myqcloud.com", true},
		{"https://test-bucket-1250000000.cos.ap-nanjing.myqcloud.com:443", true},
		{"http://test-bucket-1250000000.cos.ap-nanjing.myqcloud.com", false},
		{"https://test-bucket-1250000000.cos.ap-nanjing.myqcloud.com:8443", false},
		{"https://test-bucket-1250000000.cos.ap-nanjing.myqcloud.com.example", false},
	} {
		t.Run(tt.raw, func(t *testing.T) {
			target, err := url.Parse(tt.raw)
			if err != nil {
				t.Fatal(err)
			}
			client := TencentCOSHTTPClient(target, time.Second)
			if got := client.Transport != outboundTransport; got != tt.dedicated {
				t.Fatalf("dedicated transport = %v; want %v", got, tt.dedicated)
			}
			if tt.dedicated {
				to, err := http.NewRequest(http.MethodGet, "https://storage.example/path", nil)
				if err != nil {
					t.Fatal(err)
				}
				if err := client.CheckRedirect(to, nil); err == nil {
					t.Fatal("COS client followed a cross-origin redirect")
				}
			}
		})
	}
}
