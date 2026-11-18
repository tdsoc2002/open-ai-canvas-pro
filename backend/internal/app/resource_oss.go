// 资源对应的对象存储配置解析：系统存储、用户自有存储与历史位置。

package app

import (
	"errors"
	"strings"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func (s *Service) activeOSSSetting() (ossSettingValue, error) {
	_, setting, err := s.readOSSSetting()
	if err != nil {
		return ossSettingValue{}, err
	}
	return validateActiveOSSSetting(setting, "管理员尚未启用 OSS", "平台 OSS 配置不完整，请联系管理员")
}

func (s *Service) activeResourceOSSSetting(userID string) (ossSettingValue, string, bool, error) {
	_, systemValue, err := s.readOSSSetting()
	if err != nil {
		return ossSettingValue{}, "", false, err
	}
	if systemValue.AllowUserStorage {
		userSetting, value, err := s.readUserOSSSetting(userID)
		if err != nil {
			return ossSettingValue{}, "", false, err
		}
		if userSetting != nil && value.Enabled {
			value, err = validateActiveOSSSetting(value, "用户 OSS 尚未启用", "你的 OSS 配置不完整")
			return value, firstNonEmpty(value.StorageLocationID, userSetting.ID), true, err
		}
	}
	if !systemValue.Enabled {
		return ossSettingValue{}, "", false, nil
	}
	systemValue, err = validateActiveOSSSetting(systemValue, "管理员尚未启用 OSS", "平台 OSS 配置不完整，请联系管理员")
	return systemValue, systemValue.StorageLocationID, true, err
}

func (s *Service) ossSettingForResource(userID string, resource *model.Resource) (ossSettingValue, error) {
	return s.resolveResourceOSSSetting(userID, resource, false)
}

// Historical reads keep their original binding; a retry that writes must still be allowed.
func (s *Service) ossSettingForResourceRetry(userID string, resource *model.Resource) (ossSettingValue, error) {
	if resource.Provider == "local" {
		return ossSettingValue{}, nil
	}
	return s.resolveResourceOSSSetting(userID, resource, true)
}

func (s *Service) resolveResourceOSSSetting(userID string, resource *model.Resource, write bool) (ossSettingValue, error) {
	var setting ossSettingValue
	var err error
	if resource.StorageSettingID != "" {
		var location *model.StorageLocation
		location, setting, err = s.storageLocationValue(resource.StorageSettingID)
		personal := location != nil && location.Scope == "user"
		if personal && location.OwnerID != userID {
			return ossSettingValue{}, gorm.ErrRecordNotFound
		}
		if errors.Is(err, gorm.ErrRecordNotFound) {
			_, setting, err = s.readUserOSSSettingByID(userID, resource.StorageSettingID)
			personal = true
		}
		if err == nil && write && personal {
			if err := s.requireUserStorageAllowed(); err != nil {
				return ossSettingValue{}, err
			}
		}
		platformRotation := location != nil && location.Scope == "platform" && setting.Provider != s3Provider
		if err == nil && (!write || platformRotation) {
			var current ossSettingValue
			var currentErr error
			if personal {
				_, current, currentErr = s.readUserOSSSetting(userID)
			} else {
				_, current, currentErr = s.readOSSSetting()
			}
			if currentErr != nil && !write {
				return ossSettingValue{}, currentErr
			}
			sameLocation := currentErr == nil && resourceStorageMatches(current, resource)
			if platformRotation {
				sameLocation = sameLocation && storageLocationDigest(current) == storageLocationDigest(setting)
				// 拒绝跨位置复用平台密钥；个人与 S3 绑定仍按历史凭据处理。
				if sameLocation {
					if active, validationErr := validateActiveOSSSetting(current, "管理员尚未启用 OSS", "平台 OSS 配置不完整，请联系管理员"); validationErr == nil {
						setting.AccessKeyID, setting.AccessKeySecret, setting.SessionToken = active.AccessKeyID, active.AccessKeySecret, active.SessionToken
					}
				}
			}
			if sameLocation && !write {
				setting.CDNBaseURL = current.CDNBaseURL
				// CDN 的鉴权方式和回退策略属于分发配置，而不是资源创建时的
				// 凭据。存储位置未变时沿用当前策略，避免历史资源因管理员
				// 刚补齐 CDN 鉴权配置而继续回源。
				setting.Delivery = current.Delivery
			}
		}
	} else {
		// 早期资源没有 StorageSettingID，但资源本身仍记录了 provider/endpoint/bucket。
		// 先从用户 OSS 历史版本中按存储位置反查，不能把当前七牛配置猜给历史阿里云对象。
		setting, err = s.userOSSSettingForResource(userID, resource)
		if err == nil && write {
			if err := s.requireUserStorageAllowed(); err != nil {
				return ossSettingValue{}, err
			}
		}
		if errors.Is(err, gorm.ErrRecordNotFound) {
			_, setting, err = s.readOSSSetting()
		}
	}
	if err != nil {
		return ossSettingValue{}, err
	}
	resourceProvider := strings.ToLower(strings.TrimSpace(resource.Provider))
	resourceMatchesSetting := resourceStorageMatches(setting, resource)
	setting, err = ossSettingForProvider(setting, firstNonEmpty(resource.Provider, setting.Provider))
	if err != nil {
		return ossSettingValue{}, err
	}
	setting.Endpoint = firstNonEmpty(resource.Endpoint, setting.Endpoint)
	setting.Bucket = firstNonEmpty(resource.Bucket, setting.Bucket)
	if setting.Provider == volcengineTOSProvider {
		// 资源不记录地域；平台换地域后旧资源仍按自身域名里的地域签名。
		if region, ok := tosRegionFromEndpoint(setting.Endpoint); ok {
			setting.Region = region
		}
	}
	// CDN 是具体存储位置的出口，不得在 provider/endpoint/bucket 不匹配时继续沿用，
	// 否则切换到七牛后会把历史阿里云 objectKey 拼成七牛域名。
	if !resourceMatchesSetting || (resourceProvider != "" && resourceProvider != setting.Provider) {
		setting.CDNBaseURL = ""
	}
	if setting.AccessKeyID == "" || setting.AccessKeySecret == "" {
		return ossSettingValue{}, errors.New("对象存储访问密钥不可用")
	}
	return setting, nil
}

func (s *Service) userOSSSettingForResource(userID string, resource *model.Resource) (ossSettingValue, error) {
	settings, err := s.repo.UserOSSSettingsForUser(userID)
	if err != nil {
		return ossSettingValue{}, err
	}
	for index := range settings {
		value, valueErr := s.userOSSSettingValue(&settings[index])
		if valueErr != nil {
			return ossSettingValue{}, valueErr
		}
		if resourceStorageMatches(value, resource) {
			return value, nil
		}
	}
	return ossSettingValue{}, gorm.ErrRecordNotFound
}

func resourceStorageMatches(setting ossSettingValue, resource *model.Resource) bool {
	if resource == nil {
		return false
	}
	setting = normalizeOSSSetting(setting)
	return setting.Provider == strings.ToLower(strings.TrimSpace(resource.Provider)) &&
		setting.Endpoint == strings.TrimRight(strings.TrimSpace(resource.Endpoint), "/") &&
		setting.Bucket == strings.TrimSpace(resource.Bucket)
}

func ossSettingForProvider(setting ossSettingValue, provider string) (ossSettingValue, error) {
	setting = normalizeOSSSetting(setting)
	provider = strings.ToLower(strings.TrimSpace(provider))
	if provider == "" || provider == setting.Provider {
		return setting, nil
	}
	credentials, ok := setting.ArchivedCredentials[provider]
	if !ok || credentials.AccessKeyID == "" || credentials.AccessKeySecret == "" {
		return ossSettingValue{}, errors.New("历史对象存储访问密钥不可用")
	}
	setting.Provider = provider
	setting.AccessKeyID = credentials.AccessKeyID
	setting.AccessKeySecret = credentials.AccessKeySecret
	return setting, nil
}

func validateActiveOSSSetting(setting ossSettingValue, disabledMessage string, incompleteMessage string) (ossSettingValue, error) {
	setting = normalizeOSSSetting(setting)
	if !setting.Enabled {
		return ossSettingValue{}, BadAuthRequest(disabledMessage)
	}
	if !supportedOSSProvider(setting.Provider) {
		return ossSettingValue{}, BadAuthRequest(unsupportedOSSProviderMessage)
	}
	if setting.Bucket == "" || setting.Endpoint == "" || setting.AccessKeyID == "" || setting.AccessKeySecret == "" {
		return ossSettingValue{}, BadAuthRequest(incompleteMessage)
	}
	return setting, nil
}
